import { describe, expect, it, vi } from "vitest";
import { POST as postRefund } from "../app/api/sessions/[id]/refund/route";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, refundBlockedReason, refundPurchase, runPipeline, SessionStore, settleCreators, startPayment, viewOf, type Deps, type Session } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";
import { issuePassport } from "../src/passport/issue";
import { PassportError } from "../src/passport/passport";
import { createPayPalClient } from "../src/payments/paypal";
import { createPayPalSimulator } from "../src/payments/simulator";
import type { Runtime } from "../src/server/runtime";

/** A captured run whose payout call behaves as `payout` says; everything else is the offline simulator. */
async function captured(payout: (real: ReturnType<typeof createPayPalSimulator>["createPayout"]) => ReturnType<typeof createPayPalSimulator>["createPayout"]) {
  const sim = createPayPalSimulator({ appUrl: () => "http://app", settleAfterMs: 0 });
  const payments = { createOrder: sim.createOrder, captureOrder: sim.captureOrder, createPayout: payout(sim.createPayout), getPayout: sim.getPayout, refundCapture: sim.refundCapture };
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05" };
  const sc = scenarioById("documentary")!;
  const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
  await runPipeline(s, deps);
  approveSession(s, "Kiran");
  sim.approveOrder((await startPayment(s, deps)).id);
  await completePayment(s, deps);
  return { s, deps, sim };
}

const rejects = () => vi.fn(async () => { throw new Error("PayPal /v1/payments/payouts failed: 403 INSUFFICIENT_FUNDS"); }) as never;
const timesOut = () => vi.fn(async () => { throw new Error("fetch failed: network timeout"); }) as never;

describe("refunding a payment whose creators were never paid", () => {
  it("returns the buyer's money after a definite rejection, records it, and blocks any later payout", async () => {
    const { s, deps } = await captured(() => rejects());
    expect(s.payouts).toMatchObject({ status: "FAILED", notSent: true });
    expect(refundBlockedReason(s)).toBeUndefined();
    expect(viewOf(s).canRefund).toBe(true);

    const refund = await refundPurchase(s, deps);
    expect(refund).toMatchObject({ status: "COMPLETED", amount: { currency: "USD", value: "329.00" } });
    expect(s.phase).toBe("refunded");
    expect(s.ledger.events().at(-1)).toMatchObject({ kind: "refunded", payload: { amount: { value: "329.00" }, reason: "creator payouts could not be sent" } });
    expect(s.ledger.verify()).toBe(true);
    expect(viewOf(s)).toMatchObject({ phase: "refunded", canRefund: false, refund: { status: "COMPLETED" } });

    // Retrying payouts after a refund pays nobody; a second refund is refused; no passport exists.
    const payout = deps.payments!.createPayout as unknown as ReturnType<typeof vi.fn>;
    const before = payout.mock.calls.length;
    await settleCreators(s, deps);
    expect(payout.mock.calls.length).toBe(before); // not called again
    await expect(refundPurchase(s, deps)).rejects.toThrow(/already been refunded/);
    expect(() => issuePassport(s)).toThrow(PassportError);
  });

  it("refuses when a payout failure is not certain, because the creators may already have been paid", async () => {
    const { s, deps } = await captured(() => timesOut());
    expect(s.payouts).toMatchObject({ status: "FAILED", notSent: false });
    expect(refundBlockedReason(s)).toMatch(/may already have been sent/);
    await expect(refundPurchase(s, deps)).rejects.toThrow(/may already have been sent/);
    expect(s.phase).toBe("captured");
    expect(s.ledger.events().some((e) => e.kind === "refunded")).toBe(false);
  });

  it("stays refused when a certain-looking retry follows an unsure attempt", async () => {
    let calls = 0;
    const { s, deps } = await captured(() => vi.fn(async () => { throw new Error(++calls === 1 ? "fetch failed: socket hang up" : "PayPal /v1/payments/payouts failed: 400 BATCH_ID_ALREADY_EXISTS"); }) as never);
    await settleCreators(s, deps);
    expect(s.payouts).toMatchObject({ status: "FAILED", notSent: false });
    expect(refundBlockedReason(s)).toMatch(/may already have been sent/);
  });

  it("is never allowed once creators were paid or while they are being paid", async () => {
    const { s } = await captured((real) => real as never);
    expect(s.payouts?.status).toBe("PENDING");
    expect(refundBlockedReason(s)).toMatch(/may already have been sent/);
    s.phase = "settled";
    expect(refundBlockedReason(s)).toMatch(/Only a captured payment/);
  });

  it("is allowed when PayPal denied the whole batch, but not when any line succeeded", async () => {
    const { s } = await captured((real) => real as never);
    s.payouts = { ...s.payouts!, status: "DENIED", lines: s.payouts!.lines.map((l) => ({ ...l, status: "DENIED" })) };
    expect(refundBlockedReason(s)).toBeUndefined();
    s.payouts = { ...s.payouts, lines: s.payouts.lines.map((l, i) => ({ ...l, status: i === 0 ? "SUCCESS" : "DENIED" })) };
    expect(refundBlockedReason(s)).toMatch(/may already have been sent/);
  });

  it("is refused before capture, and on a rail that cannot refund", async () => {
    const { s, deps } = await captured(() => rejects());
    await expect(refundPurchase(s, { ...deps, payments: { ...deps.payments!, refundCapture: undefined } })).rejects.toThrow(/not available/);
    const fresh = createSession({ project: { name: "p", commercial: true, territories: ["WORLD"], termMonths: 1 }, requiredAssetIds: ["a"], documents: [{ id: "d", assetId: "a", text: "t" }] });
    expect(refundBlockedReason(fresh)).toMatch(/Only a captured payment/);
  });

  it("makes concurrent clicks one refund", async () => {
    const { s, deps } = await captured(() => rejects());
    const spy = vi.spyOn(deps.payments!, "refundCapture" as never);
    const [a, b] = await Promise.all([refundPurchase(s, deps), refundPurchase(s, deps)]);
    expect(a).toEqual(b);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("the refund route", () => {
  it("is limited to the run's owner", async () => {
    const { s, deps } = await captured(() => rejects());
    s.ownerId = "owner-aaaa-0001";
    const store = new SessionStore();
    store.add(s);
    (globalThis as unknown as { __licensegraph?: Runtime }).__licensegraph = { store, deps, demoDeps: deps, appUrl: "http://app" } as unknown as Runtime;
    const ctx = { params: Promise.resolve({ id: s.id }) };
    const call = (cookie?: string) => postRefund(new Request("http://app", { method: "POST", headers: cookie ? { Cookie: cookie } : {} }), ctx);

    expect((await call("lg_owner=stranger-bbbb-0002")).status).toBe(403);
    expect((await call()).status).toBe(403);
    const ok = await call("lg_owner=owner-aaaa-0001");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ phase: "refunded" });
    expect((await call("lg_owner=owner-aaaa-0001")).status).toBe(400);
  });
});

describe("PayPal refunds", () => {
  const base = { clientId: "id", clientSecret: "secret", baseUrl: "https://api-m.sandbox.paypal.com" };
  const route = (refund: () => Response) => vi.fn(async (url: string) => (url.endsWith("/oauth2/token") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) : refund()));

  it("refunds the whole capture with an idempotency key", async () => {
    const fetchMock = route(() => new Response(JSON.stringify({ id: "R1", status: "COMPLETED", amount: { currency_code: "USD", value: "329.00" } })));
    const client = createPayPalClient({ ...base, fetch: fetchMock as unknown as typeof fetch });
    expect(await client.refundCapture("CAP/1", "lg-r-abc")).toEqual({ id: "R1", status: "COMPLETED", amount: { currency: "USD", value: "329.00" } });
    const [url, init] = fetchMock.mock.calls.at(-1)! as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v2/payments/captures/CAP%2F1/refund");
    expect(init.headers["PayPal-Request-Id"]).toBe("lg-r-abc");
    expect(JSON.parse(init.body)).not.toHaveProperty("amount"); // no amount means the full capture
  });

  it("accepts PayPal's usual answer, which leaves the amount out", async () => {
    const client = createPayPalClient({ ...base, fetch: route(() => new Response(JSON.stringify({ id: "R3", status: "COMPLETED", links: [] }))) as unknown as typeof fetch });
    expect(await client.refundCapture("CAP", "lg-r-y")).toEqual({ id: "R3", status: "COMPLETED" });
  });

  it("records the captured amount when PayPal's answer has none", async () => {
    const { s, deps } = await captured(() => rejects());
    deps.payments = { ...deps.payments!, refundCapture: async () => ({ id: "R4", status: "COMPLETED" }) };
    await refundPurchase(s, deps);
    expect(s.refund?.amount).toEqual({ currency: "USD", value: "329.00" });
    expect(s.ledger.events().at(-1)?.payload.amount).toEqual({ currency: "USD", value: "329.00" });
    expect(viewOf(s).refund?.amount.value).toBe("329.00");
  });

  it("does not treat a pending or failed refund as done", async () => {
    const client = createPayPalClient({ ...base, fetch: route(() => new Response(JSON.stringify({ id: "R2", status: "PENDING" }))) as unknown as typeof fetch });
    await expect(client.refundCapture("CAP", "lg-r-x")).rejects.toThrow(/not completed/);
  });
});
