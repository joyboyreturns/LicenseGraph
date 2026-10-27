import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getConfig } from "../app/api/config/route";
import { POST as postIntake } from "../app/api/intake/route";
import { GET as getPassport } from "../app/api/passports/[id]/route";
import { GET as getQr } from "../app/api/passports/[id]/qr/route";
import { GET as verifyPassportRoute } from "../app/api/passports/[id]/verify/route";
import { GET as getScenarios } from "../app/api/scenarios/route";
import { POST as postApprove } from "../app/api/sessions/[id]/approve/route";
import { POST as postCapture } from "../app/api/sessions/[id]/capture/route";
import { POST as postPay } from "../app/api/sessions/[id]/pay/route";
import { POST as postPayouts } from "../app/api/sessions/[id]/payouts/route";
import { GET as getSession } from "../app/api/sessions/[id]/route";
import { GET as listSessions, POST as postSession } from "../app/api/sessions/route";
import { SessionStore } from "../src/app-logic/session";
import { greedyProposer } from "../src/agent/greedy";
import { demoModel } from "../src/demo/mock-model";
import type { Runtime } from "../src/server/runtime";

const payments = {
  createOrder: vi.fn(),
  captureOrder: vi.fn(),
  createPayout: vi.fn(),
  getPayout: vi.fn(),
};

const common = { payments, returnUrl: (id: string) => `http://app/api/sessions/${id}/return`, cancelUrl: (id: string) => `http://app/run/${id}` };

function install(over: Partial<Runtime> = {}) {
  const rt: Runtime = {
    mode: "demo",
    paymentsEnabled: true,
    appUrl: "http://app",
    passportSecret: "test-secret",
    store: new SessionStore(),
    deps: { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05", ...common },
    demoDeps: { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05", ...common },
    ...over,
  };
  (globalThis as unknown as { __licensegraph?: Runtime }).__licensegraph = rt;
  return rt;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body?: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const body = async (res: Response) => (await res.json()) as any;

async function waitFor(id: string, phase: string) {
  for (let i = 0; i < 100; i++) {
    const v = await body(await getSession(new Request("http://app"), ctx(id)));
    if (v.phase === phase) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`never reached ${phase}`);
}

beforeEach(() => {
  payments.createOrder.mockResolvedValue({ id: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD1" });
  // Like PayPal, capture exactly what was ordered.
  payments.captureOrder.mockImplementation(async () => ({ id: "ORD1", status: "COMPLETED", captureId: "CAP1", amount: { currency: "USD", value: ((payments.createOrder.mock.calls.at(-1)?.[0].amountCents ?? 0) / 100).toFixed(2) } }));
  payments.createPayout.mockResolvedValue({ batchId: "BATCH1", status: "PENDING" });
  payments.getPayout.mockResolvedValue({ batchId: "BATCH1", status: "SUCCESS", items: [] });
});
afterEach(() => {
  delete (globalThis as unknown as { __licensegraph?: Runtime }).__licensegraph;
  vi.clearAllMocks();
});

describe("scenarios and config", () => {
  it("lists scenarios with licence text but without payee emails", async () => {
    install();
    const { scenarios } = await body(await getScenarios());
    expect(scenarios.map((s: { id: string }) => s.id)).toEqual(["documentary", "game-trailer", "podcast"]);
    expect(scenarios[0].documents[0]).toMatchObject({ id: "song", licensorName: "SoundHarbor Music" });
    expect(JSON.stringify(scenarios)).not.toContain("@licensegraph-demo.example");
  });

  it("reports the runtime configuration without secrets", async () => {
    install();
    const cfg = await body(await getConfig());
    expect(cfg).toMatchObject({ mode: "demo", paymentsEnabled: true, passportSigned: true, assistant: false });
    expect(JSON.stringify(cfg)).not.toContain("test-secret");
  });
});

describe("a scenario run from start to passport", () => {
  it("runs, is approved, paid, captured and settled, then issues a verifiable passport", async () => {
    install();
    const created = await postSession(post("http://app/api/sessions", { scenarioId: "game-trailer" }));
    expect(created.status).toBe(201);
    const { id } = await body(created);

    const verified = await waitFor(id, "verified");
    expect(verified).toMatchObject({ rounds: 3, meta: { scenarioId: "game-trailer", runKind: "demo" } });
    expect(verified.analysis.blockedPurchases).toHaveLength(3);

    expect((await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id))).status).toBe(200);
    const paid = await body(await postPay(post("http://app"), ctx(id)));
    expect(paid.order.approveUrl).toContain("sandbox.paypal.com");
    expect(payments.createOrder.mock.calls[0]![0]).toMatchObject({ amountCents: 217_000, returnUrl: `http://app/api/sessions/${id}/return` });

    const done = await body(await postCapture(post("http://app"), ctx(id)));
    expect(done.phase).toBe("settled");
    expect(done.payouts).toMatchObject({ batchId: "BATCH1", totalCents: 217_000 });
    expect(JSON.stringify(done)).not.toMatch(/boomline[a-z]*@|pixelhymns@|vectororchard@/);

    const passport = await body(await getPassport(new Request("http://app/api/passports/x"), ctx(id)));
    expect(passport).toMatchObject({ version: 1, paypal: { captureId: "CAP1" }, signature: { algorithm: "HMAC-SHA256" } });

    const check = await body(await verifyPassportRoute(new Request("http://app"), ctx(id)));
    expect(check).toMatchObject({ ok: true, signature: "valid" });
    expect(check.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
  });

  it("serves the passport as a download and a QR code that points at the public page", async () => {
    install();
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(id, "verified");
    await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id));
    await postPay(post("http://app"), ctx(id));
    await postCapture(post("http://app"), ctx(id));

    const dl = await getPassport(new Request("http://app/api/passports/x?download=1"), ctx(id));
    expect(dl.headers.get("Content-Disposition")).toContain(`licence-passport-${id.slice(0, 8)}.json`);
    const qr = await getQr(new Request("http://app"), ctx(id));
    expect(qr.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await qr.text()).toContain("<svg");
  });

  it("refuses a passport before payment, and for unknown runs", async () => {
    install();
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(id, "verified");
    expect((await getPassport(new Request("http://app"), ctx(id))).status).toBe(409);
    expect((await getPassport(new Request("http://app"), ctx("nope"))).status).toBe(404);
    expect((await getQr(new Request("http://app"), ctx("nope"))).status).toBe(404);
  });

  it("keeps the order of steps: no payment before approval", async () => {
    install();
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "podcast" })));
    await waitFor(id, "verified");
    const res = await postPay(post("http://app"), ctx(id));
    expect(res.status).toBe(400);
    expect(payments.createOrder).not.toHaveBeenCalled();
  });

  it("retries payouts after a failure without touching the capture", async () => {
    install();
    payments.createPayout.mockRejectedValueOnce(new Error("403"));
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(id, "verified");
    await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id));
    await postPay(post("http://app"), ctx(id));
    const captured = await body(await postCapture(post("http://app"), ctx(id)));
    expect(captured).toMatchObject({ phase: "captured", payouts: { status: "FAILED" } });

    const retried = await body(await postPayouts(post("http://app"), ctx(id)));
    expect(retried).toMatchObject({ phase: "settled", payouts: { status: "PENDING" } });
    expect(payments.captureOrder).toHaveBeenCalledTimes(1);
  });
});

describe("custom runs and the portfolio", () => {
  const custom = { project: { name: "Mine", commercial: true, territories: ["US"], termMonths: 12 }, requiredAssetIds: ["song"], documents: [{ id: "d", assetId: "song", text: "some licence text", licensor: { name: "Bad Email", email: "not-an-email" } }] };

  it("needs a model for the user's own licences", async () => {
    install();
    const res = await postSession(post("http://app/api/sessions", custom));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/need a model/);
  });

  it("rejects unknown scenarios and malformed bodies", async () => {
    install();
    expect((await postSession(post("http://app/api/sessions", { scenarioId: "nope" }))).status).toBe(400);
    expect((await postSession(post("http://app/api/sessions", { hello: 1 }))).status).toBe(400);
    expect((await postSession(new Request("http://app/api/sessions", { method: "POST", body: "{broken" }))).status).toBe(400);
  });

  it("limits concurrent custom runs", async () => {
    const rt = install({ mode: "live", deps: { model: { complete: () => new Promise(() => {}) }, proposer: greedyProposer, ...common } });
    for (let i = 0; i < 3; i++) expect((await postSession(post("http://app/api/sessions", { ...custom, documents: [{ ...custom.documents[0], id: `d${i}` }] }))).status).toBe(201);
    expect(rt.store.activeCount()).toBe(3);
    expect((await postSession(post("http://app/api/sessions", custom))).status).toBe(429);
  });

  it("lists runs newest first with the figures a portfolio needs", async () => {
    install();
    const a = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(a.id, "verified");
    const { runs } = await body(await listSessions());
    expect(runs[0]).toMatchObject({ id: a.id, name: "Harbour documentary promo", phase: "verified", runKind: "demo", rounds: 2, totalCents: 32_900, naiveTotalCents: 29_400, blocked: 1, paid: false });
  });
});

describe("plain-English intake", () => {
  it("reads a brief locally when there is no model", async () => {
    install();
    const res = await postIntake(post("http://app/api/intake", { text: "A US ad, 12 months, under $500, song and font" }));
    expect(await body(res)).toMatchObject({ source: "local", project: { territories: ["US"], termMonths: 12, budgetCents: 50_000 }, requiredAssetIds: ["song", "font"] });
  });

  it("validates the text", async () => {
    install();
    expect((await postIntake(post("http://app/api/intake", { text: "hi" }))).status).toBe(400);
    expect((await postIntake(post("http://app/api/intake", { text: "x".repeat(2001) }))).status).toBe(413);
    expect((await postIntake(post("http://app/api/intake", {}))).status).toBe(400);
  });
});
