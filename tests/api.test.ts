import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postAsk } from "../app/api/sessions/[id]/ask/route";
import { GET as getConfig } from "../app/api/config/route";
import { GET as getPortfolio } from "../app/api/portfolio/route";
import { POST as postIntake } from "../app/api/intake/route";
import { GET as getPassport } from "../app/api/passports/[id]/route";
import { GET as getBadge } from "../app/api/passports/[id]/badge/route";
import { GET as getQr } from "../app/api/passports/[id]/qr/route";
import { GET as verifyPassportRoute } from "../app/api/passports/[id]/verify/route";
import { GET as getScenarios } from "../app/api/scenarios/route";
import { POST as postApprove } from "../app/api/sessions/[id]/approve/route";
import { POST as postCapture } from "../app/api/sessions/[id]/capture/route";
import { POST as postRevise } from "../app/api/sessions/[id]/revise/route";
import { POST as postRebrief } from "../app/api/sessions/[id]/rebrief/route";
import { POST as postPay } from "../app/api/sessions/[id]/pay/route";
import { POST as postPayouts } from "../app/api/sessions/[id]/payouts/route";
import { GET as getSession } from "../app/api/sessions/[id]/route";
import { GET as listSessions, POST as postSession } from "../app/api/sessions/route";
import { GET as getReturn } from "../app/api/sessions/[id]/return/route";
import { GET as getSimOrder, POST as postSimApprove } from "../app/api/simulator/orders/[id]/route";
import { createPayPalSimulator } from "../src/payments/simulator";
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
    paymentsMode: "paypal-sandbox",
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
const ME = "lg_owner=owner-test-0001";
const post = (url: string, body?: unknown, cookie = ME) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (url = "http://app", cookie = ME) => new Request(url, { headers: { Cookie: cookie } });
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
  payments.getPayout.mockImplementation(async () => ({ batchId: "BATCH1", status: "SUCCESS", items: (payments.createPayout.mock.calls.at(-1)?.[0].items ?? []).map((i: { itemId: string; receiver: string }) => ({ ...i, status: "SUCCESS" })) }));
});
afterEach(() => {
  delete (globalThis as unknown as { __licensegraph?: Runtime }).__licensegraph;
  vi.clearAllMocks();
});

describe("scenarios and config", () => {
  it("lists scenarios with licence text but without payee emails", async () => {
    install();
    const { scenarios } = await body(await getScenarios());
    expect(scenarios.map((s: { id: string }) => s.id)).toEqual(["documentary", "game-trailer", "podcast", "exclusive-theme"]);
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
    expect(done.phase).toBe("captured");
    expect((await waitFor(id, "settled")).phase).toBe("settled");
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
    const badge = await getBadge(new Request("http://app"), ctx(id));
    expect(badge.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(await badge.text()).toContain("LicenseGraph passport: 3 licences verified");
  });

  it("refuses a passport before payment, and for unknown runs", async () => {
    install();
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(id, "verified");
    expect((await getPassport(new Request("http://app"), ctx(id))).status).toBe(409);
    expect((await getPassport(new Request("http://app"), ctx("nope"))).status).toBe(404);
    expect((await getQr(new Request("http://app"), ctx("nope"))).status).toBe(404);
    // No badge before there is a passport, and none for a run that does not exist.
    expect((await getBadge(new Request("http://app"), ctx(id))).status).toBe(409);
    expect((await getBadge(new Request("http://app"), ctx("nope"))).status).toBe(404);
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
    expect(retried).toMatchObject({ phase: "captured", payouts: { status: "PENDING" } });
    expect(payments.captureOrder).toHaveBeenCalledTimes(1);
  });
});

describe("the payment simulator, end to end", () => {
  it("runs the whole purchase offline: checkout page, buyer approval, return redirect, capture, payouts, passport", async () => {
    const simulator = createPayPalSimulator({ appUrl: () => "http://app", settleAfterMs: 0 });
    install({ paymentsMode: "simulator", simulator, deps: { model: demoModel, proposer: greedyProposer, paymentsMode: "simulator", today: () => "2026-11-05", payments: simulator, returnUrl: (id) => `http://app/api/sessions/${id}/return`, cancelUrl: (id) => `http://app/run/${id}` }, demoDeps: { model: demoModel, proposer: greedyProposer, paymentsMode: "simulator", today: () => "2026-11-05", payments: simulator, returnUrl: (id) => `http://app/api/sessions/${id}/return`, cancelUrl: (id) => `http://app/run/${id}` } });
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "podcast" })));
    await waitFor(id, "verified");
    await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id));
    const { order } = await body(await postPay(post("http://app"), ctx(id)));
    expect(order.approveUrl).toBe(`http://app/simulator/checkout?order=${order.id}`);

    // The checkout page reads the order, then the buyer presses Approve and is sent back to the app.
    expect(await body(await getSimOrder(new Request("http://app"), ctx(order.id)))).toMatchObject({ amountCents: 69_000, approved: false });
    const early = await postCapture(post("http://app"), ctx(id)); // not approved yet
    expect(early.status).toBe(409);
    expect(await body(early)).toMatchObject({ code: "ORDER_NOT_APPROVED", error: expect.stringContaining("has not approved") });
    const approved = await body(await postSimApprove(post("http://app"), ctx(order.id)));
    expect(approved.returnUrl).toBe(`http://app/api/sessions/${id}/return`);

    const back = await getReturn(get(approved.returnUrl), ctx(id));
    expect(back.headers.get("location")).toContain(`/run/${id}`);
    const done = await waitFor(id, "settled");
    expect(done.capture).toMatchObject({ status: "COMPLETED", amount: { value: "690.00" } });
    expect(done.capture.captureId).toMatch(/^SIMCAP-/);

    const check = await body(await verifyPassportRoute(new Request("http://app"), ctx(id)));
    expect(check.ok).toBe(true);
    const passport = await body(await getPassport(new Request("http://app/api/passports/x"), ctx(id)));
    expect(passport.paypal.environment).toBe("simulator");
    expect(check.checks.find((c: { id: string }) => c.id === "payment")).toMatchObject({ label: "Simulated payment matches the bundle total" });
  });

  it("has no simulator routes when the real PayPal Sandbox is in use", async () => {
    install();
    expect((await getSimOrder(new Request("http://app"), ctx("x"))).status).toBe(404);
    expect((await postSimApprove(post("http://app"), ctx("x"))).status).toBe(404);
  });
});

describe("custom runs and the portfolio", () => {
  const custom = { project: { name: "Mine", commercial: true, territories: ["US"], termMonths: 12 }, requiredAssetIds: ["song"], documents: [{ id: "d", assetId: "song", text: "some licence text", licensor: { name: "Bad Email", email: "creator@example.test" } }] };

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

  it.each([
    { project: { ...custom.project, territories: "US" } },
    { project: { ...custom.project, commercial: "false" } },
    { project: { ...custom.project, termMonths: "12" } },
    { project: { ...custom.project, endDate: "2026-02-29" } },
    { project: { ...custom.project, budgetCents: -1 } },
    { documents: [null] },
  ])("returns a client error for malformed input instead of coercing or throwing: %j", async (changes) => {
    install({ mode: "live" });
    const response = await postSession(post("http://app/api/sessions", { ...custom, ...changes }));
    expect(response.status).toBe(400);
    expect((await body(response)).error).toMatch(/Invalid run input/);
  });

  it("accepts a licensor with only a name, and refuses a malformed payout email or a missing name", async () => {
    const docWith = (licensor: unknown) => ({ ...custom, documents: [{ ...custom.documents[0], licensor }] });
    install({ mode: "live", deps: { model: { complete: () => new Promise(() => {}) }, proposer: greedyProposer, ...common } });
    expect((await postSession(post("http://app/api/sessions", docWith({ name: "Just A Name" })))).status).toBe(201);
    expect((await postSession(post("http://app/api/sessions", docWith({ name: "Has Email", email: "a@example.test" })))).status).toBe(201);
    for (const bad of [{ name: "Bad", email: "not-an-email" }, { email: "a@example.test" }, { name: "" }]) {
      const res = await postSession(post("http://app/api/sessions", docWith(bad)));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
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
    const { runs } = await body(await listSessions(get()));
    expect(runs[0]).toMatchObject({ id: a.id, name: "Harbour documentary promo", phase: "verified", runKind: "demo", rounds: 2, totalCents: 32_900, naiveTotalCents: 29_400, blocked: 1, paid: false });
  });
});

describe("asking about a run", () => {
  it("answers from the run's facts without a model, and validates the question", async () => {
    install();
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(id, "verified");
    const a = await body(await postAsk(post("http://app", { question: "Why was the photo rejected?" }), ctx(id)));
    expect(a).toMatchObject({ source: "local", citations: ["offer-photo"] });
    expect((await postAsk(post("http://app", { question: "?" }), ctx(id))).status).toBe(400);
    expect((await postAsk(post("http://app", { question: "x".repeat(401) }), ctx(id))).status).toBe(413);
    expect((await postAsk(post("http://app", { question: "why?" }), ctx("nope"))).status).toBe(404);
  });

  it("uses the model while the budget lasts, then the offline answer", async () => {
    const complete = vi.fn().mockResolvedValue("offer-photo failed the commercial-use rule.");
    install({ intakeModel: { complete } });
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(id, "verified");
    const sources: string[] = [];
    for (let i = 0; i < 6; i++) sources.push((await body(await postAsk(post("http://app", { question: "why photo rejected" }), ctx(id)))).source);
    expect(sources.filter((x) => x === "model").length).toBeLessThanOrEqual(4);
    expect(sources.at(-1)).toBe("local");
  });
});

describe("run ownership", () => {
  const STRANGER = "lg_owner=stranger-0002";

  async function paidRun() {
    install();
    const created = await postSession(post("http://app/api/sessions", { scenarioId: "documentary" }));
    const { id } = await body(created);
    await waitFor(id, "verified");
    return { id, created };
  }

  it("hands a new browser an owner cookie that page scripts cannot read, and keeps an existing one", async () => {
    install();
    const first = await postSession(new Request("http://app/api/sessions", { method: "POST", body: JSON.stringify({ scenarioId: "documentary" }) }));
    expect(first.headers.get("set-cookie")).toMatch(/^lg_owner=[\w-]{36}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Lax$/);
    const again = await postSession(post("http://app/api/sessions", { scenarioId: "documentary" }));
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("marks the cookie Secure when the app is served over https", async () => {
    install({ appUrl: "https://example.ts.net" });
    const res = await postSession(new Request("http://app/api/sessions", { method: "POST", body: JSON.stringify({ scenarioId: "documentary" }) }));
    expect(res.headers.get("set-cookie")).toMatch(/; Secure$/);
  });

  it("lets only the creating browser approve, pay, capture or retry payouts", async () => {
    const { id } = await paidRun();
    for (const [handler, name] of [[postApprove, "approve"], [postPay, "pay"], [postCapture, "capture"], [postPayouts, "payouts"]] as const) {
      const res = await handler(post("http://app", { approvedBy: "Mallory" }, STRANGER), ctx(id));
      expect(res.status, name).toBe(403);
      expect((await body(res)).error).toMatch(/another browser session/);
    }
    expect(payments.createOrder).not.toHaveBeenCalled();
    expect((await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id))).status).toBe(200);
  });

  it("refuses a request with no cookie at all", async () => {
    const { id } = await paidRun();
    expect((await postApprove(new Request("http://app", { method: "POST", body: JSON.stringify({ approvedBy: "x" }) }), ctx(id))).status).toBe(403);
  });

  it("does not let a shared return URL bypass capture ownership", async () => {
    const { id } = await paidRun();
    await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id));
    await postPay(post("http://app"), ctx(id));
    const response = await getReturn(get(`http://app/api/sessions/${id}/return`, STRANGER), ctx(id));
    expect(response.status).toBe(307);
    expect(payments.captureOrder).not.toHaveBeenCalled();
  });

  it("still lets anyone with the link read the run and its passport", async () => {
    const { id } = await paidRun();
    await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id));
    await postPay(post("http://app"), ctx(id));
    await postCapture(post("http://app"), ctx(id));
    expect((await getSession(get("http://app", STRANGER), ctx(id))).status).toBe(200);
    expect((await getPassport(get("http://app/api/passports/x", STRANGER), ctx(id))).status).toBe(200);
    expect((await verifyPassportRoute(get("http://app", STRANGER), ctx(id))).status).toBe(200);
  });

  it("lists and exports only the caller's own runs", async () => {
    const { id } = await paidRun();
    const mine = await body(await listSessions(get()));
    expect(mine.runs.map((r: { id: string }) => r.id)).toEqual([id]);
    expect((await body(await listSessions(get("http://app", STRANGER)))).runs).toEqual([]);
    expect((await body(await getPortfolio(get("http://app", STRANGER)))).views).toEqual([]);
    expect((await body(await getPortfolio(get()))).views).toHaveLength(1);
  });

  it("leaves runs from before owners existed open to everyone", async () => {
    const rt = install();
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(id, "verified");
    delete rt.store.get(id)!.ownerId;
    expect((await postApprove(post("http://app", { approvedBy: "Anyone" }, STRANGER), ctx(id))).status).toBe(200);
    expect((await body(await listSessions(get("http://app", STRANGER)))).runs).toHaveLength(1);
  });
});

describe("portfolio", () => {
  it("returns every run without licence text, with payout status brought up to date", async () => {
    install();
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "documentary" })));
    await waitFor(id, "verified");
    await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id));
    await postPay(post("http://app"), ctx(id));
    await postCapture(post("http://app"), ctx(id));
    payments.getPayout.mockImplementation(async () => ({ batchId: "BATCH1", status: "SUCCESS", items: (payments.createPayout.mock.calls.at(-1)?.[0].items ?? []).map((i: { itemId: string; receiver: string }) => ({ ...i, status: "SUCCESS" })) }));

    const { views } = await body(await getPortfolio(get()));
    expect(views).toHaveLength(1);
    expect(views[0].documents.every((d: { text: string }) => d.text === "")).toBe(true);
    expect(views[0].payouts.status).toBe("SUCCESS");
    expect(views[0].project.name).toBe("Harbour documentary promo");
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


describe("making a what-if real: the same licences against a changed brief", () => {
  const start = async (scenarioId: string) => (await body(await postSession(post("http://app/api/sessions", { scenarioId })))).id as string;

  it("starts a new run that reads nothing again, verifies the cheaper bundle, links back, and leaves the first as it was", async () => {
    install();
    const id = await start("documentary");
    const first = await waitFor(id, "verified");
    expect(first.bundle.totalCents).toBe(32_900);

    const res = await postRebrief(post("http://app", { change: { commercial: false } }), ctx(id));
    expect(res.status).toBe(201);
    const created = await body(res);
    expect(created.id).not.toBe(id);
    const next = await waitFor(created.id, "verified");
    expect(next.project.commercial).toBe(false);
    expect(next.meta.rebriefedFrom).toBe(id);
    expect(next.meta.brief).toBeUndefined();
    expect(next.bundle.totalCents).toBe(29_400);
    // The first entry of the new ledger: what changed, and what the earlier run ended with.
    expect(next.events[0]).toMatchObject({ seq: 1, kind: "brief_changed", payload: { fromRunId: id, earlierOutcome: "verified", earlierTotalCents: 32_900, change: { commercial: false }, described: ["not commercial"] } });
    // Every licence was carried over from the first run, not read again.
    expect(next.events.filter((e: { kind: string }) => e.kind === "extracted").every((e: { payload: { carriedFromRun?: string } }) => e.payload.carriedFromRun === id)).toBe(true);
    expect(next.chainValid).toBe(true);
    const listed = (await body(await listSessions(get()))).runs as { id: string; rebriefedFrom?: string }[];
    expect(listed.find((r) => r.id === created.id)?.rebriefedFrom).toBe(id);
    expect(listed.find((r) => r.id === id)?.rebriefedFrom).toBeUndefined();

    const again = await body(await getSession(get(), ctx(id)));
    expect(again.project.commercial).toBe(true);
    expect(again.bundle.totalCents).toBe(32_900);
  });

  it("refuses an empty or malformed change, a run still going, another browser's run, and a run with a payment", async () => {
    install();
    const id = await start("documentary");
    await waitFor(id, "verified");
    for (const change of [{}, { termMonths: 0 }, { territories: ["Nowhere"] }, { commercial: "yes" }]) {
      expect((await postRebrief(post("http://app", { change }), ctx(id))).status, JSON.stringify(change)).toBe(400);
    }
    expect((await postRebrief(post("http://app", {}), ctx(id))).status).toBe(400);
    expect((await postRebrief(post("http://app", { change: { commercial: false } }, "lg_owner=someone-else-0001"), ctx(id))).status).toBe(403);
    expect((await postRebrief(post("http://app", { change: { commercial: false } }), ctx("no-such-run"))).status).toBe(404);

    await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(id));
    expect((await postRebrief(post("http://app", { change: { commercial: false } }), ctx(id))).status).toBe(400);
  });

  it("can turn a run with no bundle into one that can be bought, by dropping what blocked it", async () => {
    install();
    const id = await start("exclusive-theme");
    await waitFor(id, "failed");
    const created = await body(await postRebrief(post("http://app", { change: { requiresExclusive: false } }), ctx(id)));
    const next = await waitFor(created.id, "verified");
    expect(next.events[0]).toMatchObject({ kind: "brief_changed", payload: { earlierOutcome: "no compliant bundle", earlierTotalCents: null, described: ["exclusivity not needed"] } });
    expect(next.bundle.totalCents).toBe(69_000);
  });
});

describe("answering a gap request", () => {
  const start = async (scenarioId: string) => {
    const created = await body(await postSession(post("http://app/api/sessions", { scenarioId })));
    return created.id as string;
  };

  it("simulated replies start a new run that verifies, link back to the first, and leave the first as it was", async () => {
    install();
    const id = await start("exclusive-theme");
    const first = await waitFor(id, "failed");
    expect(first.bundle).toBeUndefined();

    const res = await postRevise(post("http://app", { simulate: true }), ctx(id));
    expect(res.status).toBe(201);
    const created = await body(res);
    expect(created.id).not.toBe(id);
    const next = await waitFor(created.id, "verified");
    expect(next.meta.revisedFrom).toBe(id);
    // The link is the first entry of the new run's hash-chained ledger: what failed, what was asked, what was added.
    expect(next.events[0]).toMatchObject({ seq: 1, kind: "answers_run", payload: { fromRunId: id, earlierOutcome: "no compliant bundle", addedDocumentIds: ["pod-song-exclusive", "pod-art-exclusive", "pod-voice-exclusive"] } });
    expect(next.events[0].payload.asked.map((a: { assetId: string; priceCents: number; currency: string }) => [a.assetId, a.priceCents, a.currency])).toEqual([["song", 34_000, "USD"], ["image", 14_000, "USD"], ["voiceover", 21_000, "USD"]]);
    expect(next.events[0].payload.asked.map((a: { assetId: string; rules: string[] }) => [a.assetId, a.rules])).toEqual([["song", ["exclusivity"]], ["image", ["exclusivity"]], ["voiceover", ["exclusivity"]]]);
    expect(next.bundle.totalCents).toBe(52_000 + 26_000 + 38_000);
    const listed = (await body(await listSessions(get()))).runs as { id: string; revisedFrom?: string }[];
    expect(listed.find((r) => r.id === created.id)?.revisedFrom).toBe(id);
    expect(listed.find((r) => r.id === id)?.revisedFrom).toBeUndefined();
    expect(next.bundle.offers.map((o: { id: string }) => o.id).sort()).toEqual(["offer-pod-art-exclusive", "offer-pod-song-exclusive", "offer-pod-voice-exclusive"]);

    expect((await body(await getSession(new Request("http://app"), ctx(id)))).phase).toBe("failed");
  });

  it("only the owner of the run may answer it", async () => {
    install();
    const id = await start("exclusive-theme");
    await waitFor(id, "failed");
    const res = await postRevise(post("http://app", { simulate: true }, "lg_owner=someone-else-9999"), ctx(id));
    expect(res.status).toBe(403);
  });

  it("refuses pasted licences when the server has no model, and a run that is not finished or has a payment", async () => {
    install();
    const id = await start("exclusive-theme");
    await waitFor(id, "failed");
    const pasted = await postRevise(post("http://app", { assetId: "song", text: "Price: USD 500.00." }), ctx(id));
    expect(pasted.status).toBe(400);
    expect((await body(pasted)).error).toMatch(/needs a model/);
    expect((await postRevise(post("http://app", { nonsense: true }), ctx(id))).status).toBe(400);
    expect((await postRevise(post("http://app", { simulate: true }), ctx("nope"))).status).toBe(404);

    const paid = await start("podcast");
    await waitFor(paid, "verified");
    await postApprove(post("http://app", { approvedBy: "Kiran" }), ctx(paid));
    await postPay(post("http://app"), ctx(paid));
    const late = await postRevise(post("http://app", { simulate: true }), ctx(paid));
    expect(late.status).toBe(400);
    expect((await body(late)).error).toMatch(/payment in progress/);
  });
});

describe("a run that ended before any proposal", () => {
  it("can still be asked about, listed, and exported without errors", async () => {
    install();
    const { id } = await body(await postSession(post("http://app/api/sessions", { scenarioId: "exclusive-theme" })));
    const view = await waitFor(id, "failed");
    expect(view.rounds ?? 0).toBe(0);
    expect(view.bundle).toBeUndefined();
    const answer = await body(await postAsk(post("http://app", { question: "Why could nothing be bought?" }), ctx(id)));
    expect(typeof answer.answer).toBe("string");
    expect(answer.answer.length).toBeGreaterThan(10);
    const listed = (await body(await listSessions(get()))).runs as { id: string; phase: string; rounds?: number }[];
    expect(listed.find((r) => r.id === id)).toMatchObject({ phase: "failed" });
    expect((await getPortfolio(get())).status).toBe(200);
  });
});
