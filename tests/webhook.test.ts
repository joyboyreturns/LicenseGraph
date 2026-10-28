import { describe, expect, it, vi } from "vitest";
import { POST as postWebhook } from "../app/api/webhooks/paypal/route";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, refundPurchase, runPipeline, SessionStore, startPayment, type Deps } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";
import { issuePassport } from "../src/passport/issue";
import { verifyPassport } from "../src/passport/passport";
import { createPayPalClient } from "../src/payments/paypal";
import { createPayPalSimulator } from "../src/payments/simulator";
import { readWebhookHeaders } from "../src/payments/webhook";
import type { Runtime } from "../src/server/runtime";

const GOOD = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "paypal-transmission-id": "tx-1", "paypal-transmission-sig": "c2ln", "paypal-transmission-time": "2026-11-05T10:00:00Z" };

describe("reading PayPal's transmission headers", () => {
  it("accepts a complete set from paypal.com", () => {
    expect(readWebhookHeaders(new Headers(GOOD))).toMatchObject({ authAlgo: "SHA256withRSA", transmissionId: "tx-1", certUrl: GOOD["paypal-cert-url"] });
  });
  it("refuses a missing header, a certificate off paypal.com, and plain http", () => {
    for (const k of Object.keys(GOOD)) expect(readWebhookHeaders(new Headers({ ...GOOD, [k]: "" })), k).toBeUndefined();
    for (const cert of ["https://evil.example/certs/1", "https://evilpaypal.com/certs/1", "https://paypal.com.evil.example/certs/1", "http://api.paypal.com/certs/1", "not a url"]) {
      expect(readWebhookHeaders(new Headers({ ...GOOD, "paypal-cert-url": cert })), cert).toBeUndefined();
    }
  });
});

async function setup(verify: (...a: any[]) => Promise<boolean> = async () => true, webhookId: string | null = "WH-1") {
  const sim = createPayPalSimulator({ appUrl: () => "http://app", settleAfterMs: 0 });
  const verifyWebhookSignature = vi.fn(verify);
  const payments = { createOrder: sim.createOrder, captureOrder: sim.captureOrder, createPayout: sim.createPayout, getPayout: sim.getPayout, refundCapture: sim.refundCapture, verifyWebhookSignature };
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05" };
  const store = new SessionStore();
  (globalThis as unknown as { __licensegraph?: Runtime }).__licensegraph = { mode: "demo", appUrl: "http://app", store, deps, demoDeps: deps, webhookId: webhookId ?? undefined } as unknown as Runtime;
  const approved = async () => {
    const sc = scenarioById("documentary")!;
    const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
    store.add(s);
    await runPipeline(s, deps);
    approveSession(s, "Kiran");
    const order = await startPayment(s, deps);
    return { s, order };
  };
  const captured = async () => {
    const { s, order } = await approved();
    sim.approveOrder(order.id);
    await completePayment(s, deps);
    return s;
  };
  return { sim, deps, store, verifyWebhookSignature, approved, captured };
}

const deliver = (event: unknown, headers: Record<string, string> = GOOD, raw?: string) =>
  postWebhook(new Request("http://app/api/webhooks/paypal", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw ?? JSON.stringify(event) }));
const body = async (res: Response) => (await res.json()) as any;
const approvedEvent = (orderId: string) => ({ id: "WH-EVT-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: orderId } });

describe("the webhook endpoint refuses what PayPal has not vouched for", () => {
  it("answers 503 when no webhook id is set, and never calls PayPal", async () => {
    const t = await setup(async () => true, null);
    const res = await deliver({ event_type: "X" });
    expect(res.status).toBe(503);
    expect(t.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it("answers 400 for missing headers or a body that is not a JSON object, without asking PayPal", async () => {
    const t = await setup();
    expect((await deliver({}, { "paypal-transmission-id": "x" })).status).toBe(400);
    expect((await deliver(null, GOOD, "not json")).status).toBe(400);
    expect((await deliver(null, GOOD, "[1,2]")).status).toBe(400);
    expect((await deliver(null, GOOD, "x".repeat(300_000))).status).toBe(413);
    expect(t.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it("answers 401 and leaves the run untouched when PayPal does not confirm the signature", async () => {
    const t = await setup(async () => false);
    const { s, order } = await t.approved();
    t.sim.approveOrder(order.id);
    const res = await deliver(approvedEvent(order.id));
    expect(res.status).toBe(401);
    expect(s.phase).toBe("order_created");
    expect(s.capture).toBeUndefined();
  });

  it("answers 502 when PayPal cannot be reached, so PayPal delivers again", async () => {
    const t = await setup(async () => { throw new Error("fetch failed"); });
    const { s, order } = await t.approved();
    t.sim.approveOrder(order.id);
    expect((await deliver(approvedEvent(order.id))).status).toBe(502);
    expect(s.phase).toBe("order_created");
  });

  it("forwards the exact headers, webhook id and event to PayPal", async () => {
    const t = await setup();
    const event = { id: "WH-9", event_type: "SOMETHING.ELSE", resource: { a: 1 } };
    const res = await deliver(event);
    expect(await body(res)).toMatchObject({ received: true, ignored: expect.stringContaining("SOMETHING.ELSE") });
    expect(t.verifyWebhookSignature).toHaveBeenCalledWith({ headers: expect.objectContaining({ transmissionId: "tx-1", transmissionSig: "c2ln" }), webhookId: "WH-1", event });
  });
});

describe("verified events", () => {
  it("captures the approved order even though the buyer's browser never came back, and pays the creators once", async () => {
    const t = await setup();
    const { s, order } = await t.approved();
    t.sim.approveOrder(order.id);
    const res = await deliver(approvedEvent(order.id));
    expect(await body(res)).toMatchObject({ received: true, handled: expect.stringContaining("captured"), runId: s.id });
    expect(s.capture?.captureId).toBeTruthy();
    expect(["captured", "settled"]).toContain(s.phase);
    expect(s.payouts?.batchId).toBeTruthy();
    const kinds = s.ledger.events().map((e) => e.kind);
    expect(kinds.filter((k) => k === "captured")).toHaveLength(1);

    // PayPal redelivers: nothing happens twice.
    const again = await body(await deliver(approvedEvent(order.id)));
    expect(again.ignored).toMatch(/not waiting/);
    expect(s.ledger.events().map((e) => e.kind).filter((k) => k === "captured")).toHaveLength(1);
    expect(s.ledger.verify()).toBe(true);
  });

  it("ignores an approval for an order no run created", async () => {
    await setup();
    expect((await body(await deliver(approvedEvent("NOT-OURS")))).ignored).toMatch(/no run/);
  });

  it("brings the payout status up to date when PayPal reports the batch", async () => {
    const t = await setup();
    const s = await t.captured();
    s.payouts!.status = "PENDING";
    s.payoutsCheckedAt = Date.now();
    const res = await body(await deliver({ id: "WH-2", event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS", resource: { batch_header: { payout_batch_id: s.payouts!.batchId } } }));
    expect(res).toMatchObject({ handled: expect.stringContaining("payout"), runId: s.id });
    expect(s.payouts!.status).toBe("SUCCESS");
    expect(s.phase).toBe("settled");
  });
});

describe("a payment reversed outside the app", () => {
  const reversal = (captureId: string, id = "WH-REV-1") => ({ id, event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REFUND-1", amount: { currency_code: "USD", value: "329.00" }, links: [{ rel: "up", href: `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}` }] } });

  it("is written to the ledger once, and the Licence Passport stops saying the licences are covered", async () => {
    const t = await setup();
    const s = await t.captured();
    expect((await verifyPassport(issuePassport(s))).checks.find((c) => c.id === "payment-standing")).toMatchObject({ ok: true });

    const first = await body(await deliver(reversal(s.capture!.captureId)));
    expect(first).toMatchObject({ handled: expect.stringContaining("reversal"), runId: s.id });
    const again = await body(await deliver(reversal(s.capture!.captureId)));
    expect(again.ignored).toBe("already recorded");

    const events = s.ledger.events().filter((e) => e.kind === "payment_reversed");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ eventId: "WH-REV-1", captureId: s.capture!.captureId, amount: { currency: "USD", value: "329.00" } });
    expect(s.ledger.verify()).toBe(true);

    const check = await verifyPassport(issuePassport(s));
    expect(check.ok).toBe(false);
    expect(check.checks.find((c) => c.id === "payment-standing")).toMatchObject({ ok: false, detail: expect.stringContaining("no longer covered") });
    expect(check.checks.filter((c) => c.id !== "payment-standing").every((c) => c.ok)).toBe(true);
  });

  it("does not report the app's own refund as an outside reversal, even if PayPal's notice arrives first", async () => {
    const t = await setup();
    const sc = scenarioById("documentary")!;
    const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
    t.store.add(s);
    // Creators cannot be paid, so the buyer is refunded by the app.
    t.deps.payments!.createPayout = vi.fn(async () => { throw new Error("PayPal /v1/payments/payouts failed: 403 INSUFFICIENT_FUNDS"); }) as never;
    await runPipeline(s, t.deps);
    approveSession(s, "Kiran");
    t.sim.approveOrder((await startPayment(s, t.deps)).id);
    await completePayment(s, t.deps);
    // Hold the refund open at PayPal so the notice about it reaches the server first.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const realRefund = t.deps.payments!.refundCapture!;
    t.deps.payments!.refundCapture = (async (...a: Parameters<typeof realRefund>) => { await gate; return realRefund(...a); }) as never;
    const refunding = refundPurchase(s, t.deps);
    const notice = deliver(reversal(s.capture!.captureId, "WH-REV-2"));
    await new Promise((r) => setTimeout(r, 30));
    expect(s.refund).toBeUndefined();
    release();
    await refunding;
    expect((await body(await notice)).ignored).toMatch(/refund the app made/);
    expect(s.ledger.events().some((e) => e.kind === "payment_reversed")).toBe(false);
    expect(s.ledger.events().filter((e) => e.kind === "refunded")).toHaveLength(1);
  });

  it("ignores a capture no run owns", async () => {
    await setup();
    expect((await body(await deliver(reversal("UNKNOWN")))).ignored).toMatch(/no run/);
  });
});

describe("verifying a signature with PayPal", () => {
  it("posts the transmission and the event to the Sandbox verification endpoint and reads the verdict", async () => {
    const calls: { url: string; body: any }[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ verification_status: calls.length === 1 ? "SUCCESS" : "FAILURE" }));
    });
    const client = createPayPalClient({ clientId: "id", clientSecret: "secret", baseUrl: "https://api-m.sandbox.paypal.com", fetch: fetch as never });
    const headers = readWebhookHeaders(new Headers(GOOD))!;
    const event = { id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED" };
    expect(await client.verifyWebhookSignature({ headers, webhookId: "WH-1", event })).toBe(true);
    expect(calls[0]).toEqual({
      url: "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature",
      body: { auth_algo: "SHA256withRSA", cert_url: GOOD["paypal-cert-url"], transmission_id: "tx-1", transmission_sig: "c2ln", transmission_time: "2026-11-05T10:00:00Z", webhook_id: "WH-1", webhook_event: event },
    });
    expect(await client.verifyWebhookSignature({ headers, webhookId: "WH-1", event })).toBe(false);
  });
});
