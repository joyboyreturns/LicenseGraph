import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postApprove } from "../app/api/sessions/[id]/approve/route";
import { POST as postClaim } from "../app/api/sessions/[id]/claim/route";
import { POST as postPay } from "../app/api/sessions/[id]/pay/route";
import { GET as getSession } from "../app/api/sessions/[id]/route";
import { GET as listSessions, POST as postSession } from "../app/api/sessions/route";
import { greedyProposer } from "../src/agent/greedy";
import { claimSession, createSession, reserveForPerson, SessionError, SessionStore } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";
import { FileSessionRepository } from "../src/app-logic/persistence";
import type { Runtime } from "../src/server/runtime";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const payments = { createOrder: vi.fn(async () => ({ id: "ORDER1", status: "PAYER_ACTION_REQUIRED", approveUrl: "http://pay" })), captureOrder: vi.fn(), createPayout: vi.fn(), getPayout: vi.fn() };
const deps = { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05", payments };

function install(store = new SessionStore()) {
  const rt = { mode: "demo", paymentsEnabled: true, paymentsMode: "paypal-sandbox", appUrl: "http://app", store, deps, demoDeps: deps } as unknown as Runtime;
  (globalThis as unknown as { __licensegraph?: Runtime }).__licensegraph = rt;
  return rt;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, body: unknown, cookie?: string) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;

async function agentRun(scenarioId = "documentary") {
  const res = await postSession(req("http://app/api/sessions", { scenarioId, handoff: true }));
  expect(res.status).toBe(201);
  const view = await json(res);
  for (let i = 0; i < 100; i++) {
    const v = await json(await getSession(new Request("http://app"), ctx(view.id)));
    if (v.phase === "verified") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return { res, view };
}

beforeEach(() => install());

describe("an agent starting a purchase for a person", () => {
  it("returns a claim link once, sets no owner cookie, and says the run is waiting for a person", async () => {
    const { res, view } = await agentRun();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(view.awaitingPerson).toBe(true);
    expect(view.meta.startedBy).toBe("agent");
    const url = new URL(view.handoff.claimUrl);
    expect(url.origin + url.pathname).toBe(`http://app/claim/${view.id}`);
    expect(url.searchParams.get("token")).toMatch(/^[\w-]{32}$/);
    // The token is never shown again, to the agent or anyone else.
    expect(JSON.stringify(await json(await getSession(new Request("http://app"), ctx(view.id))))).not.toContain(url.searchParams.get("token")!);
  });

  it("cannot be approved or paid by the agent, or by anyone, until a person claims it", async () => {
    const { view } = await agentRun();
    for (const cookie of [undefined, "lg_owner=some-browser-0001", `lg_owner=${"agent-".padEnd(20, "x")}`]) {
      expect((await postApprove(req("http://app", { approvedBy: "x" }, cookie), ctx(view.id))).status).toBe(403);
      expect((await postPay(req("http://app", {}, cookie), ctx(view.id))).status).toBe(403);
    }
    // And it is not in anyone's run list.
    const list = await json(await listSessions(new Request("http://app", { headers: { Cookie: "lg_owner=some-browser-0001" } })));
    expect(list.runs.map((r: { id: string }) => r.id)).not.toContain(view.id);
  });

  it("lets the person who presents the token take control, once, and records it in the ledger", async () => {
    const { view } = await agentRun();
    const token = new URL(view.handoff.claimUrl).searchParams.get("token")!;
    const PERSON = "lg_owner=person-browser-0001";

    expect((await postClaim(req("http://app", { token: "wrong" }, PERSON), ctx(view.id))).status).toBe(400);
    expect((await postClaim(req("http://app", {}, PERSON), ctx(view.id))).status).toBe(400);
    const claimed = await postClaim(req("http://app", { token }, PERSON), ctx(view.id));
    expect(claimed.status).toBe(200);
    const after = await json(claimed);
    expect(after.awaitingPerson).toBeUndefined();
    expect(after.chainValid).toBe(true);
    expect(after.events.at(-1)).toMatchObject({ kind: "handed_over", payload: { startedBy: "agent" } });

    // The token is spent; a second browser cannot reuse it, and the agent still cannot approve.
    expect((await postClaim(req("http://app", { token }, "lg_owner=other-browser-0002"), ctx(view.id))).status).toBe(400);
    expect((await postApprove(req("http://app", { approvedBy: "x" }, "lg_owner=other-browser-0002"), ctx(view.id))).status).toBe(403);

    const approved = await postApprove(req("http://app", { approvedBy: "Kiran" }, PERSON), ctx(view.id));
    expect(approved.status).toBe(200);
    expect((await json(approved)).phase).toBe("approved");
  });

  it("gives a first-time browser an owner cookie when it takes control", async () => {
    const { view } = await agentRun();
    const token = new URL(view.handoff.claimUrl).searchParams.get("token")!;
    const res = await postClaim(req("http://app", { token }), ctx(view.id));
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^lg_owner=[\w-]{36}; .*HttpOnly/);
    const mine = cookie.split(";")[0]!;
    expect((await postApprove(req("http://app", { approvedBy: "Kiran" }, mine), ctx(view.id))).status).toBe(200);
  });

  it("an ordinary run is unchanged: no claim link, the creator owns it", async () => {
    const res = await postSession(req("http://app/api/sessions", { scenarioId: "documentary" }, "lg_owner=creator-0001"));
    const view = await json(res);
    expect(view.handoff).toBeUndefined();
    expect(view.awaitingPerson).toBeUndefined();
  });
});

describe("an agent's spending mandate", () => {
  it("is written to the ledger beside the verified total, and survives the person taking control", async () => {
    const res = await postSession(req("http://app/api/sessions", { scenarioId: "documentary", handoff: true, mandate: { maxTotalCents: 40_000, currency: "USD", note: "Under $400" } }));
    expect(res.status).toBe(201);
    const { id } = await json(res);
    let v: any;
    for (let i = 0; i < 100 && v?.phase !== "verified"; i++) {
      v = await json(await getSession(new Request("http://app"), ctx(id)));
      await new Promise((r) => setTimeout(r, 20));
    }
    const event = v.events.find((e: { kind: string }) => e.kind === "mandate_checked");
    expect(event.payload).toMatchObject({ status: "within", marginCents: 7_100, maxTotalCents: 40_000, totalCents: 32_900, currency: "USD", note: "Under $400" });
    expect(v.chainValid).toBe(true);
  });

  it("is refused when malformed, and absent when not stated", async () => {
    for (const mandate of [{ maxTotalCents: -5, currency: "USD" }, { maxTotalCents: 100, currency: "ZZZ" }, { maxTotalCents: 1.5, currency: "USD" }]) {
      expect((await postSession(req("http://app/api/sessions", { scenarioId: "documentary", handoff: true, mandate }))).status).toBe(400);
    }
    const { id } = await json(await postSession(req("http://app/api/sessions", { scenarioId: "documentary", handoff: true })));
    await new Promise((r) => setTimeout(r, 100));
    expect((await json(await getSession(new Request("http://app"), ctx(id)))).events.some((e: { kind: string }) => e.kind === "mandate_checked")).toBe(false);
  });
});

describe("claim tokens", () => {
  const make = () => {
    const sc = scenarioById("documentary")!;
    return createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
  };

  it("expire, and stay valid for exactly their lifetime", () => {
    const s = make();
    const t0 = new Date("2026-11-05T10:00:00Z");
    const { token, expiresAt } = reserveForPerson(s, t0);
    expect(Date.parse(expiresAt) - t0.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(() => claimSession(s, token, "owner-1234", new Date(Date.parse(expiresAt) + 1))).toThrow(/expired/);
    expect(() => claimSession(s, token, "owner-1234", new Date(Date.parse(expiresAt) - 1))).not.toThrow();
  });

  it("are stored only as a hash and survive a restart", () => {
    const repo = new FileSessionRepository(mkdtempSync(join(tmpdir(), "lg-claim-")));
    const store = new SessionStore(10, repo);
    const s = make();
    const { token } = reserveForPerson(s);
    store.add(s);

    const saved = JSON.stringify(s.claim);
    expect(saved).not.toContain(token);
    const restored = new SessionStore(10, repo).get(s.id)!;
    expect(restored.claim).toEqual(s.claim);
    expect(restored.ownerId).toBe(s.ownerId);
    expect(() => claimSession(restored, token, "owner-5678")).not.toThrow();
    expect(() => claimSession(restored, token, "owner-9999")).toThrow(SessionError);
  });
});
