import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, SessionError, SessionStore, startPayment, viewOf, type Deps, type SessionInput } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";
import { paymentRequestId } from "../src/payments/request-id";

const created = { id: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD1" };
const captured = { id: "ORD1", status: "COMPLETED", captureId: "CAP1", amount: { currency: "USD", value: "329.00" } };

const makeDeps = (over: Partial<Deps> = {}) => {
  const payments = { createOrder: vi.fn().mockResolvedValue(created), captureOrder: vi.fn().mockResolvedValue(captured) };
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05", ...over };
  return { deps, payments };
};

const input = (): SessionInput => ({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
const kinds = (s: ReturnType<typeof createSession>) => s.ledger.events().map((e) => e.kind);

describe("full flow", () => {
  it("extracts, rejects the cheap non-commercial image, revises, approves, pays and captures", async () => {
    const { deps, payments } = makeDeps();
    const s = createSession(input());

    await runPipeline(s, deps);
    expect(s.phase).toBe("verified");
    expect(s.candidates).toHaveLength(4);
    expect(s.loop!.rounds).toBe(2);
    expect(s.loop!.bundle!.offers.map((o) => o.id)).toEqual(["offer-song", "offer-archive", "offer-font"]);

    approveSession(s, "  Kiran  ");
    expect(s.approval!.approvedBy).toBe("Kiran");

    const order = await startPayment(s, deps);
    expect(order.id).toBe("ORD1");
    expect(payments.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 20_000 + 8_000 + 4_900, currency: "USD", requestId: expect.stringMatching(/^lg-o-[a-f0-9]{32}$/) }));

    await completePayment(s, deps);
    expect(s.phase).toBe("captured");
    expect(payments.captureOrder).toHaveBeenCalledWith("ORD1", paymentRequestId("capture", s.id));

    expect(kinds(s)).toEqual(["extracted", "extracted", "extracted", "extracted", "proposed", "rejected", "revised", "verified", "approved", "order_created", "captured"]);
    expect(s.ledger.verify()).toBe(true);
  });

  it("exposes a view with the ledger and a valid chain, and nothing secret", async () => {
    const { deps } = makeDeps();
    const s = createSession(input());
    await runPipeline(s, deps);
    const v = viewOf(s);

    expect(v).toMatchObject({ phase: "verified", loopStatus: "verified", chainValid: true, bundle: { totalCents: 32_900, currency: "USD" } });
    expect(v.events.length).toBe(8);
    expect(JSON.stringify(v)).not.toMatch(/secret|password/i);
  });

  it("passes return and cancel URLs to PayPal", async () => {
    const { deps, payments } = makeDeps({ returnUrl: (id) => `http://app/return?session=${id}`, cancelUrl: (id) => `http://app/cancel?session=${id}` });
    const s = createSession(input());
    await runPipeline(s, deps);
    approveSession(s, "Kiran");
    await startPayment(s, deps);
    expect(payments.createOrder).toHaveBeenCalledWith(expect.objectContaining({ returnUrl: `http://app/return?session=${s.id}`, cancelUrl: `http://app/cancel?session=${s.id}` }));
  });
});

describe("the order of steps is enforced", () => {
  it("coalesces simultaneous order and capture requests into one ledger transition each", async () => {
    const { deps, payments } = makeDeps();
    const s = createSession(input());
    await runPipeline(s, deps);
    approveSession(s, "Kiran");
    const orders = await Promise.all([startPayment(s, deps), startPayment(s, deps), startPayment(s, deps)]);
    expect(new Set(orders.map((o) => o.id)).size).toBe(1);
    await Promise.all([completePayment(s, deps), completePayment(s, deps), completePayment(s, deps)]);
    expect(payments.createOrder).toHaveBeenCalledTimes(1);
    expect(payments.captureOrder).toHaveBeenCalledTimes(1);
    expect(kinds(s).filter((k) => k === "captured")).toHaveLength(1);
    expect(kinds(s).filter((k) => k === "order_created")).toHaveLength(1);
  });

  it.each([
    { ...captured, status: "PENDING" },
    { ...captured, id: "OTHER-ORDER" },
    { ...captured, amount: { currency: "EUR", value: "329.00" } },
    { ...captured, amount: { currency: "USD", value: "328.99" } },
  ])("never marks an incorrect capture as paid: %j", async (response) => {
    const { deps, payments } = makeDeps();
    payments.captureOrder.mockResolvedValue(response);
    const s = createSession(input());
    await runPipeline(s, deps);
    approveSession(s, "Kiran");
    await startPayment(s, deps);
    await expect(completePayment(s, deps)).rejects.toThrow(/completed capture/);
    expect(s.phase).toBe("order_created");
    expect(s.capture).toBeUndefined();
    expect(kinds(s)).not.toContain("captured");
  });

  it("cannot approve before verification, or with no name", async () => {
    const { deps } = makeDeps();
    const s = createSession(input());
    expect(() => approveSession(s, "Kiran")).toThrow(SessionError);
    await runPipeline(s, deps);
    expect(() => approveSession(s, "   ")).toThrow(/name is required/);
    expect(s.phase).toBe("verified");
  });

  it("cannot pay before approval, and never calls PayPal", async () => {
    const { deps, payments } = makeDeps();
    const s = createSession(input());
    await runPipeline(s, deps);
    await expect(startPayment(s, deps)).rejects.toThrow(/Approve the verified bundle/);
    expect(payments.createOrder).not.toHaveBeenCalled();
  });

  it("cannot capture before an order exists, or twice", async () => {
    const { deps, payments } = makeDeps();
    const s = createSession(input());
    await runPipeline(s, deps);
    approveSession(s, "Kiran");
    await expect(completePayment(s, deps)).rejects.toThrow(/No PayPal order/);
    await startPayment(s, deps);
    await completePayment(s, deps);
    await expect(completePayment(s, deps)).rejects.toThrow(/No PayPal order/);
    expect(payments.captureOrder).toHaveBeenCalledTimes(1);
  });

  it("cannot start a second order or run the pipeline twice", async () => {
    const { deps } = makeDeps();
    const s = createSession(input());
    await runPipeline(s, deps);
    await expect(runPipeline(s, deps)).rejects.toThrow(/Cannot run/);
    approveSession(s, "Kiran");
    await startPayment(s, deps);
    await expect(startPayment(s, deps)).rejects.toThrow(/Approve the verified bundle/);
  });

  it("explains when PayPal is not configured", async () => {
    const { deps } = makeDeps({ payments: undefined });
    const s = createSession(input());
    await runPipeline(s, deps);
    approveSession(s, "Kiran");
    await expect(startPayment(s, deps)).rejects.toThrow(/PayPal is not configured/);
  });

  it("keeps the order waiting when PayPal says the buyer has not approved yet", async () => {
    const { deps, payments } = makeDeps();
    payments.captureOrder.mockRejectedValueOnce(new Error("PayPal capture failed: 422 ORDER_NOT_APPROVED"));
    const s = createSession(input());
    await runPipeline(s, deps);
    approveSession(s, "Kiran");
    await startPayment(s, deps);

    await expect(completePayment(s, deps)).rejects.toThrow(/ORDER_NOT_APPROVED/);
    expect(s.phase).toBe("order_created");
    await completePayment(s, deps);
    expect(s.phase).toBe("captured");
  });
});

describe("when no compliant bundle exists", () => {
  it("distinguishes an agent stall from proof that no compliant bundle exists", async () => {
    const { deps } = makeDeps({ proposer: { propose: async () => ({ offerIds: ["offer-song", "offer-photo", "offer-font"], rationale: "Always pick the cheap offer" }) } });
    const s = createSession(input());
    await runPipeline(s, deps);
    expect(s.phase).toBe("failed");
    expect(s.failure).toMatch(/available compliant bundle/);
    expect(viewOf(s).analysis!.optimization.plans[0]!.totalCents).toBe(32_900);
  });
  it("fails the session, explains why, and blocks approval and payment", async () => {
    const { deps, payments } = makeDeps();
    const i = input();
    i.documents = i.documents.filter((d) => d.id !== "archive"); // only the non-commercial image remains
    const s = createSession(i);
    await runPipeline(s, deps);

    expect(s.phase).toBe("failed");
    expect(s.failure).toMatch(/No licence bundle/);
    expect(viewOf(s).bundle).toBeUndefined();
    expect(() => approveSession(s, "Kiran")).toThrow(/verified/);
    await expect(startPayment(s, deps)).rejects.toThrow();
    expect(payments.createOrder).not.toHaveBeenCalled();
  });

  it("says so honestly when no licence could be read, and never asks the proposer", async () => {
    const proposer = { propose: vi.fn() };
    const { deps } = makeDeps({ model: { complete: vi.fn().mockRejectedValue(new Error("gateway down")) }, proposer });
    const s = createSession(input());
    await runPipeline(s, deps);

    expect(s.phase).toBe("failed");
    expect(s.failure).toMatch(/Could not read the licence terms for: song, image, font/);
    expect(kinds(s)).toEqual(["extraction_failed", "extraction_failed", "extraction_failed", "extraction_failed"]);
    expect(proposer.propose).not.toHaveBeenCalled();
  });
});

describe("input validation", () => {
  const bad = (change: (i: SessionInput) => void, message: RegExp) => {
    const i = input();
    change(i);
    expect(() => createSession(i)).toThrow(message);
  };
  it("rejects incomplete input", () => {
    bad((i) => (i.project.name = " "), /name/);
    bad((i) => (i.project.territories = []), /territory/);
    bad((i) => (i.project.termMonths = 0), /term/);
    bad((i) => (i.requiredAssetIds = []), /required asset/);
    bad((i) => (i.documents = []), /at least one licence/);
    bad((i) => (i.documents[0]!.text = "  "), /empty/);
    bad((i) => (i.documents[1]!.id = i.documents[0]!.id), /unique/);
    bad((i) => i.requiredAssetIds.push("video"), /video/);
  });
});

describe("SessionStore", () => {
  it("stores and returns sessions by id", () => {
    const store = new SessionStore();
    const s = store.add(createSession(input()));
    expect(store.get(s.id)).toBe(s);
    expect(store.get("nope")).toBeUndefined();
  });

  it("evicts the oldest finished session when full, never one still running", () => {
    const store = new SessionStore(2);
    const oldRunning = store.add(createSession(input()));
    oldRunning.phase = "extracting";
    const finished = store.add(createSession(input()));
    finished.phase = "captured";

    const fresh = store.add(createSession(input()));
    expect(store.get(oldRunning.id)).toBeDefined();
    expect(store.get(finished.id)).toBeUndefined();
    expect(store.get(fresh.id)).toBeDefined();
  });

  it("counts runs still in progress", () => {
    const store = new SessionStore();
    const a = store.add(createSession(input()));
    const b = store.add(createSession(input()));
    a.phase = "proposing";
    b.phase = "verified";
    expect(store.activeCount()).toBe(1);
  });
});
