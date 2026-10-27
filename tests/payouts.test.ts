import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, refreshPayouts, runPipeline, settleCreators, startPayment, viewOf, type Deps } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";
import { applyPayoutStatus, planPayouts } from "../src/payments/payouts";
import { createPayPalClient } from "../src/payments/paypal";

const created = { id: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD1" };
const captured = { id: "ORD1", status: "COMPLETED", captureId: "CAP1", amount: { currency: "USD", value: "329.00" } };

const makeDeps = (over: Partial<Deps> = {}) => {
  const payments = {
    createOrder: vi.fn().mockResolvedValue(created),
    captureOrder: vi.fn().mockResolvedValue(captured),
    createPayout: vi.fn().mockResolvedValue({ batchId: "BATCH1", status: "PENDING" }),
    getPayout: vi.fn().mockResolvedValue({ batchId: "BATCH1", status: "SUCCESS", items: [{ itemId: "offer-song", status: "SUCCESS", receiver: "x" }, { itemId: "offer-archive", status: "SUCCESS", receiver: "x" }, { itemId: "offer-font", status: "SUCCESS", receiver: "x" }] }),
  };
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05", ...over };
  return { deps, payments };
};
const input = () => ({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });

const paid = async (deps: Deps) => {
  const s = createSession(input());
  await runPipeline(s, deps);
  approveSession(s, "Kiran");
  await startPayment(s, deps);
  await completePayment(s, deps);
  return s;
};

describe("planPayouts", () => {
  const s = createSession(input());
  const offers = (ids: string[]) => ids.map((id) => ({ id: `offer-${id}`, assetId: id, priceCents: 100, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 12 as const }, evidence: [{ documentId: id, quote: "q" }] }));

  it("pays each licensor the price of their licence", () => {
    const { lines, unpaid } = planPayouts(offers(["song", "font"]), s.input.documents);
    expect(lines.map((l) => [l.licensorName, l.amountCents, l.email])).toEqual([["SoundHarbor Music", 100, "soundharbor@licensegraph-demo.example"], ["TypeForge Studio", 100, "typeforge@licensegraph-demo.example"]]);
    expect(unpaid).toEqual([]);
  });

  it("swaps in override accounts in order, one per licensor", () => {
    const { lines } = planPayouts(offers(["song", "font", "archive"]), s.input.documents, ["a@x.test", "b@x.test"]);
    expect(lines.map((l) => l.email)).toEqual(["a@x.test", "b@x.test", "a@x.test"]);
  });

  it("leaves out offers whose document names no licensor, and says so", () => {
    const docs = s.input.documents.map((d) => (d.id === "font" ? { ...d, licensor: undefined } : d));
    const { lines, unpaid } = planPayouts(offers(["song", "font"]), docs);
    expect(lines).toHaveLength(1);
    expect(unpaid).toEqual([{ assetId: "font", offerId: "offer-font" }]);
  });

  it("folds a fresh PayPal status into the summary", () => {
    const summary = { batchId: "B", status: "PENDING", totalCents: 100, currency: "USD", createdAt: "x", lines: [{ assetId: "song", offerId: "offer-song", documentId: "song", licensorName: "n", email: "e", amountCents: 100, currency: "USD", status: "PENDING" }] };
    const next = applyPayoutStatus(summary, { batchId: "B", status: "SUCCESS", items: [{ itemId: "offer-song", status: "SUCCESS", receiver: "e" }] });
    expect(next).toMatchObject({ status: "SUCCESS", lines: [{ status: "SUCCESS" }] });
  });
});

describe("settling creators after capture", () => {
  it("creates one payout batch for the verified bundle and records it", async () => {
    const { deps, payments } = makeDeps();
    const s = await paid(deps);

    expect(s.phase).toBe("settled");
    expect(payments.createPayout).toHaveBeenCalledTimes(1);
    const call = payments.createPayout.mock.calls[0]![0];
    expect(call.batchId).toBe(`lg-payout-${s.id}`);
    expect(call.items.map((i: { itemId: string; amountCents: number }) => [i.itemId, i.amountCents])).toEqual([["offer-song", 20_000], ["offer-archive", 8_000], ["offer-font", 4_900]]);
    expect(s.ledger.events().map((e) => e.kind).slice(-3)).toEqual(["order_created", "captured", "payout_created"]);
    expect(s.payouts).toMatchObject({ batchId: "BATCH1", status: "PENDING", totalCents: 32_900 });
  });

  it("keeps real email addresses out of the ledger and the view", async () => {
    const { deps } = makeDeps();
    const s = await paid(deps);
    expect(JSON.stringify(s.ledger.events())).not.toContain("@licensegraph-demo.example");
    const view = viewOf(s);
    expect(JSON.stringify(view)).not.toContain("soundharbor@");
    expect(view.payouts!.lines[0]).toMatchObject({ licensorName: "SoundHarbor Music", emailMasked: "so•••••••••@licensegraph-demo.example" });
  });

  it("uses override accounts when configured", async () => {
    const { deps, payments } = makeDeps({ payeeOverrides: ["sb-creator@personal.example.com"] });
    await paid(deps);
    expect(payments.createPayout.mock.calls[0]![0].items.every((i: { receiver: string }) => i.receiver === "sb-creator@personal.example.com")).toBe(true);
  });

  it("never undoes the capture when the payout fails, and can retry", async () => {
    const { deps, payments } = makeDeps();
    payments.createPayout.mockRejectedValueOnce(new Error("PayPal /v1/payments/payouts failed: 403"));
    const s = await paid(deps);

    expect(s.phase).toBe("captured");
    expect(s.capture!.status).toBe("COMPLETED");
    expect(s.payouts).toMatchObject({ status: "FAILED", error: expect.stringContaining("403") });
    expect(s.ledger.events().at(-1)!.kind).toBe("payout_failed");

    await settleCreators(s, deps);
    expect(s.phase).toBe("settled");
    expect(s.payouts!.status).toBe("PENDING");
    expect(s.payouts!.batchId).toBe("BATCH1");
    expect(payments.createPayout).toHaveBeenCalledTimes(2);
  });

  it("does not pay twice", async () => {
    const { deps, payments } = makeDeps();
    const s = await paid(deps);
    await settleCreators(s, deps);
    expect(payments.createPayout).toHaveBeenCalledTimes(1);
  });

  it("skips payouts quietly when the client cannot do them", async () => {
    const { deps } = makeDeps();
    delete (deps.payments as { createPayout?: unknown }).createPayout;
    const s = await paid(deps);
    expect(s.phase).toBe("captured");
    expect(s.payouts).toBeUndefined();
  });
});

describe("refreshPayouts", () => {
  it("records the moment the batch reaches a final state, once", async () => {
    const { deps, payments } = makeDeps();
    const s = await paid(deps);
    let t = 10_000;
    await refreshPayouts(s, deps, () => t);
    expect(s.payouts!.status).toBe("SUCCESS");
    expect(s.payouts!.lines.every((l) => l.status === "SUCCESS")).toBe(true);
    expect(s.ledger.events().at(-1)).toMatchObject({ kind: "payout_settled", payload: { status: "SUCCESS" } });

    t += 60_000;
    await refreshPayouts(s, deps, () => t);
    expect(payments.getPayout).toHaveBeenCalledTimes(1);
  });

  it("throttles checks and tolerates a failing status call", async () => {
    const { deps, payments } = makeDeps();
    payments.getPayout.mockRejectedValue(new Error("network"));
    const s = await paid(deps);
    await refreshPayouts(s, deps, () => 1_000);
    await refreshPayouts(s, deps, () => 2_000);
    expect(payments.getPayout).toHaveBeenCalledTimes(1);
    expect(s.payouts!.status).toBe("PENDING");
  });
});

describe("createPayPalClient payouts", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it("posts a batch with the batch id as the idempotency key and reads status back", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: "t", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ batch_header: { payout_batch_id: "PB1", batch_status: "PENDING" } }, 201))
      .mockResolvedValueOnce(json({ batch_header: { payout_batch_id: "PB1", batch_status: "SUCCESS" }, items: [{ transaction_status: "SUCCESS", payout_item: { sender_item_id: "i1", receiver: "r@x.test" } }] }));
    const client = createPayPalClient({ clientId: "id", clientSecret: "s", baseUrl: "https://api-m.sandbox.paypal.com", fetch: fetchMock as unknown as typeof fetch });

    expect(await client.createPayout({ batchId: "lg-1", subject: "s", items: [{ itemId: "i1", receiver: "r@x.test", amountCents: 1250, currency: "USD", note: "n" }] })).toEqual({ batchId: "PB1", status: "PENDING" });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(init.headers["PayPal-Request-Id"]).toBe("lg-1");
    expect(JSON.parse(init.body)).toMatchObject({ sender_batch_header: { sender_batch_id: "lg-1" }, items: [{ amount: { value: "12.50", currency: "USD" }, sender_item_id: "i1" }] });

    expect(await client.getPayout("PB1")).toEqual({ batchId: "PB1", status: "SUCCESS", items: [{ itemId: "i1", status: "SUCCESS", receiver: "r@x.test", error: undefined }] });
    expect(fetchMock.mock.calls[2]![1].method).toBe("GET");
  });
});
