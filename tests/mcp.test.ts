import { beforeEach, describe, expect, it } from "vitest";
import { POST as postApprove } from "../app/api/sessions/[id]/approve/route";
import { POST as postClaim } from "../app/api/sessions/[id]/claim/route";
import { GET as getSession } from "../app/api/sessions/[id]/route";
import { POST as postSession } from "../app/api/sessions/route";
import { greedyProposer } from "../src/agent/greedy";
import { SessionStore } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";
import { checkBundle, cheapestBundle, licenceEndDates, purchaseStatus, startPurchase, whatIfBrief, whatIfInput, type AppClient } from "../src/mcp/tools";
import type { Runtime } from "../src/server/runtime";
import { runExample } from "./mcp-fixtures";

/** A fetch that talks straight to the app's own route handlers, so the test exercises the real handoff. */
function appInProcess(): AppClient {
  const model = { complete: demoModel.complete }; // a different object than the demo model, so own licences are accepted
  const deps = { model, proposer: greedyProposer, today: () => "2026-11-05" };
  (globalThis as unknown as { __licensegraph?: Runtime }).__licensegraph = { mode: "live", paymentsEnabled: false, paymentsMode: "none", appUrl: "http://app", store: new SessionStore(), deps, demoDeps: { ...deps, model: demoModel } } as unknown as Runtime;
  const fetchShim = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const req = new Request(url, init);
    if (path === "/api/sessions" && init?.method === "POST") return postSession(req);
    const id = path.split("/")[3]!;
    return getSession(req, ctx(id));
  }) as unknown as typeof fetch;
  return { baseUrl: "http://app", fetch: fetchShim };
}

const { project, requiredAssetIds, offers } = await runExample();

describe("check_licence_bundle", () => {
  it("returns the rules engine's verdict, with every violation", () => {
    const bad = checkBundle({ project, requiredAssetIds, offers, chosenOfferIds: ["offer-photo", "offer-song", "offer-font"] });
    expect(bad.ok).toBe(false);
    expect((bad as { violations: { rule: string }[] }).violations.map((v) => v.rule)).toContain("commercial-use");

    const good = checkBundle({ project, requiredAssetIds, offers, chosenOfferIds: ["offer-archive", "offer-song", "offer-font"] });
    expect(good).toMatchObject({ ok: true, totalCents: 32_900, violations: [] });
  });

  it("refuses ids that are not among the offers", () => {
    expect(checkBundle({ project, requiredAssetIds, offers, chosenOfferIds: ["offer-nope"] })).toEqual({ ok: false, error: "Unknown offer ids: offer-nope" });
  });
});

describe("cheapest_compliant_bundle", () => {
  it("finds the exact minimum and what each requirement adds to it", () => {
    const r = cheapestBundle({ project, requiredAssetIds, offers });
    expect(r.plans[0]).toMatchObject({ currency: "USD", totalCents: 32_900, offerIds: ["offer-font", "offer-archive", "offer-song"] });
    expect(r.requirementCosts?.items.find((i) => i.rule === "commercial-use")).toMatchObject({ extraCents: 3_500 });
    expect(r.gapRequests).toEqual([]);
  });

  it("says what to ask for when nothing passes", () => {
    const r = cheapestBundle({ project: { ...project, requiresExclusive: true }, requiredAssetIds, offers });
    expect(r.plans).toEqual([]);
    expect(r.requirementCosts).toBeNull();
    expect(r.gapRequests.length).toBe(requiredAssetIds.length);
    expect(r.gapRequests[0]!.asks.map((a) => a.rule)).toContain("exclusivity");
  });

  it("prices a yes to every ask, and says nothing about it when something already passes", () => {
    const blocked = cheapestBundle({ project: { ...project, requiresExclusive: true }, requiredAssetIds, offers });
    expect(blocked.ifLicensorsAgree).toMatchObject({ currency: "USD", asked: expect.arrayContaining(requiredAssetIds) });
    expect(blocked.ifLicensorsAgree!.assets).toHaveLength(requiredAssetIds.length);
    expect(blocked.ifLicensorsAgree!.totalCents).toBeGreaterThan(0);
    expect(cheapestBundle({ project, requiredAssetIds, offers }).ifLicensorsAgree).toBeNull();
  });
});

describe("what_if_brief", () => {
  it("with no change, says the brief costs what the cheapest bundle costs", () => {
    const r = whatIfBrief({ project, requiredAssetIds, offers, change: {} });
    expect(r).toMatchObject({ currency: "USD", baselineCents: 32_900, totalCents: 32_900, deltaCents: 0, shifts: [], uncoveredAssets: [] });
  });

  it("prices a change exactly: dropping commercial use saves what the requirement costs", () => {
    const r = whatIfBrief({ project, requiredAssetIds, offers, change: { commercial: false } });
    expect(r.deltaCents).toBe(-3_500);
    expect(r.totalCents).toBe(29_400);
    expect(r.shifts).toHaveLength(1);
  });

  it("agrees with cheapest_compliant_bundle on the brief it is asked about", () => {
    const changed = { ...project, termMonths: 36 };
    const viaWhatIf = whatIfBrief({ project, requiredAssetIds, offers, change: { termMonths: 36 } }).totalCents;
    const viaCheapest = cheapestBundle({ project: changed, requiredAssetIds, offers }).plans[0]?.totalCents;
    expect(viaWhatIf).toBe(viaCheapest);
  });

  it("says what to ask for when the changed brief has no licence", () => {
    const r = whatIfBrief({ project, requiredAssetIds, offers, change: { requiresExclusive: true } });
    expect(r.totalCents).toBeUndefined();
    expect(r.uncoveredAssets.length).toBe(requiredAssetIds.length);
    expect(r.gaps[0]!.asks.map((a) => a.rule)).toContain("exclusivity");
  });

  it("validates what an agent sends", () => {
    const base = { project, requiredAssetIds, offers };
    expect(whatIfInput.safeParse({ ...base, change: { territories: ["us", "ca"], termMonths: 24 } }).success).toBe(true);
    expect(whatIfInput.parse({ ...base, change: { territories: ["us"] } }).change.territories).toEqual(["US"]);
    for (const change of [{ termMonths: 0 }, { termMonths: 1.5 }, { territories: [] }, { territories: ["United States"] }, { commercial: "yes" }]) {
      expect(whatIfInput.safeParse({ ...base, change }).success, JSON.stringify(change)).toBe(false);
    }
  });
});

describe("start_licence_purchase", () => {
  let app: AppClient;
  beforeEach(() => {
    app = appInProcess();
  });

  const sc = scenarioById("documentary")!;
  const input = () => ({ project: sc.project, requiredAssetIds: sc.requiredAssetIds, documents: sc.documents.map((d) => ({ ...d })) });

  it("starts a run for a person; the agent can follow it but never approve it", async () => {
    const started = await startPurchase(app, input());
    if (!started.ok) throw new Error(started.error);
    expect(started.claimUrl).toMatch(/^http:\/\/app\/claim\/[\w-]+\?token=[\w-]+$/);

    let status = await purchaseStatus(app, started.runId);
    for (let i = 0; i < 100 && status.ok && status.phase !== "verified"; i++) {
      await new Promise((r) => setTimeout(r, 20));
      status = await purchaseStatus(app, started.runId);
    }
    expect(status).toMatchObject({ ok: true, phase: "verified", awaitingPerson: true, ledgerIntact: true, payment: null, passportUrl: null });
    expect(status.ok && status.bundle).toMatchObject({ totalCents: 32_900, currency: "USD" });

    // The agent has no owner cookie and no token: approving is refused.
    const attempt = await postApprove(new Request("http://app", { method: "POST", body: JSON.stringify({ approvedBy: "agent" }) }), { params: Promise.resolve({ id: started.runId }) });
    expect(attempt.status).toBe(403);

    // A person follows the link and takes control.
    const token = new URL(started.claimUrl).searchParams.get("token")!;
    const claimed = await postClaim(new Request("http://app", { method: "POST", headers: { "Content-Type": "application/json", Cookie: "lg_owner=person-0001-abcd" }, body: JSON.stringify({ token }) }), { params: Promise.resolve({ id: started.runId }) });
    expect(claimed.status).toBe(200);
    expect(await purchaseStatus(app, started.runId)).toMatchObject({ awaitingPerson: false });
  });

  it("reports the app's refusal rather than throwing", async () => {
    const res = await startPurchase(app, { ...input(), requiredAssetIds: ["song", "missing"] });
    expect(res).toMatchObject({ ok: false });
    expect(res.ok === false && res.error).toMatch(/No licence document for: missing/);
    expect(await purchaseStatus(app, "no-such-run")).toMatchObject({ ok: false });
  });
});

describe("licence_end_dates", () => {
  it("counts each licence from the purchase day, soonest first, and returns a calendar with a reminder per end", () => {
    const r = licenceEndDates({ offers, boughtOn: "2026-11-05", projectName: "Docs" });
    expect(r.boughtOn).toBe("2026-11-05");
    expect(r.ends.length).toBe(offers.length);
    for (let i = 1; i < r.ends.length; i++) expect((r.ends[i - 1]!.endsOn ?? "9999") <= (r.ends[i]!.endsOn ?? "9999")).toBe(true);
    const dated = r.ends.filter((e) => e.endsOn).length;
    expect(r.calendar.match(/BEGIN:VEVENT/g)?.length ?? 0).toBe(dated);
    expect(r.calendar).toContain("TRIGGER:-P30D");
  });

  it("can be limited to the offers that were bought", () => {
    const only = offers[0]!.id;
    expect(licenceEndDates({ offers, offerIds: [only], boughtOn: "2026-11-05" }).ends.map((e) => e.offerId)).toEqual([only]);
  });
});
