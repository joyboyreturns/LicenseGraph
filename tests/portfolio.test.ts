import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, startPayment, viewOf, type Deps } from "../src/app-logic/session";
import { buildPortfolioData, PORTFOLIO_INITIAL_STATE } from "../src/dashboard/portfolio";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";
import { createPayPalSimulator } from "../src/payments/simulator";

const sim = createPayPalSimulator({ appUrl: () => "http://app", settleAfterMs: 0 });
const deps: Deps = { model: demoModel, proposer: greedyProposer, payments: sim, today: () => "2026-11-05" };

async function run(id: string, pay: boolean) {
  const sc = scenarioById(id)!;
  const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })), meta: { scenarioId: id, runKind: "demo" } });
  await runPipeline(s, deps);
  if (pay) {
    approveSession(s, "Kiran");
    const order = await startPayment(s, deps);
    sim.approveOrder(order.id);
    await completePayment(s, deps);
  }
  return viewOf(s);
}

describe("buildPortfolioData", () => {
  it("flattens several runs into linked tables keyed by run id", async () => {
    const views = [await run("documentary", true), await run("game-trailer", false), await run("podcast", true)];
    const def = buildPortfolioData(views);

    expect(def.sources.map((s) => s.id)).toEqual(["runs", "offers", "violations", "payouts", "licences", "requirements", "events"]);
    const runs = def.sources[0]!.data;
    expect(runs.map((r) => [r.run, r.status, r.paid, r.rounds])).toEqual([["Harbour documentary promo", "captured", "Paid", 2], ["Neon Drift launch trailer", "verified", "Not paid", 3], ["Signal & Noise podcast network", "captured", "Paid", 2]]);
    expect(runs[1]).toMatchObject({ verifiedTotal: 2170, priceOnlyTotal: 220, compliancePremium: 1950, blockedLicences: 3, source: "Replayed demo" });
  });

  it("includes every offer, violation and payout line with its run", async () => {
    const views = [await run("documentary", true), await run("podcast", true)];
    const [, offers, violations, payouts] = buildPortfolioData(views).sources.map((s) => s.data);
    expect(offers).toHaveLength(4 + 6);
    expect(new Set(offers!.map((o) => o.runId))).toEqual(new Set(views.map((v) => v.id)));
    expect(violations!.every((x) => typeof x.runId === "string" && x.rule)).toBe(true);
    expect(payouts!.map((p) => [p.run, p.licensor, p.amount])).toEqual([
      ["Harbour documentary promo", "SoundHarbor Music", 200], ["Harbour documentary promo", "HistoryVault Archive", 80], ["Harbour documentary promo", "TypeForge Studio", 49],
      ["Signal & Noise podcast network", "Tapeloop", 340], ["Signal & Noise podcast network", "Greyscale Lane", 140], ["Signal & Noise podcast network", "Marlow Voice", 210],
    ]);
  });

  it("lists when each bought licence ends, only for paid runs, and calls a perpetual licence perpetual", async () => {
    const views = [await run("podcast", true), await run("game-trailer", false)];
    const licences = buildPortfolioData(views).sources.find((x) => x.id === "licences")!.data;
    expect(licences.every((l) => l.run === "Signal & Noise podcast network")).toBe(true); // the unpaid run has nothing bought
    const by = Object.fromEntries(licences.map((l) => [l.asset as string, l]));
    // Bought on the day the payment was captured; the podcast licences are 36 months, and the cover art is perpetual.
    const bought = String(by.song!.boughtOn);
    expect(bought).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(by.song).toMatchObject({ licensor: "Tapeloop", price: 340, cover: "Ends", endsYear: Number(bought.slice(0, 4)) + 3 });
    expect(by.image).toMatchObject({ licensor: "Greyscale Lane", endsOn: "Perpetual", endsYear: null, cover: "Perpetual" });
  });

  it("says who started each run and whether an agent's spending cap held", async () => {
    const person = await run("documentary", false);
    const agent = structuredClone(person);
    agent.id = "agent-run";
    agent.meta = { ...agent.meta, startedBy: "agent" };
    agent.events = [...agent.events, { seq: 99, at: "2026-11-05T00:00:00Z", kind: "mandate_checked", payload: { status: "over", overByCents: 100 }, prevHash: "x", hash: "y" }];
    const rows = buildPortfolioData([person, agent]).sources.find((x) => x.id === "runs")!.data;
    expect(rows.map((r) => [r.startedBy, r.mandate])).toEqual([["Person", "None stated"], ["AI agent", "Over cap"]]);
  });

  it("says how each run began: on its own, after a licensor replied, or from a changed brief", async () => {
    const original = await run("documentary", false);
    const revised = structuredClone(original);
    revised.id = "revised-run";
    revised.meta = { ...revised.meta, revisedFrom: original.id };
    const rebriefed = structuredClone(original);
    rebriefed.id = "rebriefed-run";
    rebriefed.meta = { ...rebriefed.meta, rebriefedFrom: original.id };
    const rows = buildPortfolioData([original, revised, rebriefed]).sources.find((x) => x.id === "runs")!.data;
    expect(rows.map((r) => r.origin)).toEqual(["Original", "After a licensor reply", "Changed brief"]);
    // The same bundle as the run it came from: no movement. A run with no source in the portfolio, or no bundle, has nothing to show.
    expect(rows.map((r) => r.changeVsSource)).toEqual([null, 0, 0]);
    const cheaper = structuredClone(rebriefed);
    cheaper.bundle = { ...cheaper.bundle!, totalCents: cheaper.bundle!.totalCents - 3_500 };
    const moved = buildPortfolioData([original, cheaper]).sources.find((x) => x.id === "runs")!.data;
    expect(moved.map((r) => r.changeVsSource)).toEqual([null, -35]);
    const orphan = buildPortfolioData([cheaper]).sources.find((x) => x.id === "runs")!.data;
    expect(orphan[0]!.changeVsSource).toBeNull();
  });

  it("is consistent: every row has every declared field, and relationships point at real fields", async () => {
    const def = buildPortfolioData([await run("game-trailer", true)]);
    const fields = Object.fromEntries(def.sources.map((s) => [s.id, new Set(s.fields.map((f) => f.id))]));
    for (const s of def.sources) for (const row of s.data) for (const f of s.fields) expect(f.id in row, `${s.id}.${f.id}`).toBe(true);
    for (const r of def.relationships) {
      expect(fields[r.source.tableId]!.has(r.source.fieldId)).toBe(true);
      expect(fields[r.target.tableId]!.has(r.target.fieldId)).toBe(true);
    }
  });

  it("copes with no runs and with a run that failed", async () => {
    expect(buildPortfolioData([]).sources.every((s) => s.data.length === 0)).toBe(true);
    const failed = createSession({ project: { ...scenarioById("documentary")!.project }, requiredAssetIds: ["song"], documents: [{ id: "song", assetId: "song", text: "unknown licence text" }] });
    await runPipeline(failed, deps);
    const def = buildPortfolioData([viewOf(failed)]);
    expect(def.sources[0]!.data[0]).toMatchObject({ status: "failed", verifiedTotal: null, blockedLicences: 0, paid: "Not paid" });
  });

  it("the starting dashboard only references fields that exist", async () => {
    const def = buildPortfolioData([await run("documentary", false)]);
    const known = new Set(def.sources.flatMap((s) => s.fields.map((f) => `${s.id}.${f.id}`)));
    const page = PORTFOLIO_INITIAL_STATE.pages[0]!;
    const ids: string[] = [];
    for (const w of Object.values(page.widgets) as { dataMapping: Record<string, { id: string }[]> }[]) for (const refs of Object.values(w.dataMapping)) ids.push(...refs.map((r) => r.id));
    expect(ids.filter((id) => !known.has(id))).toEqual([]);
    expect(Object.keys(page.widgetLayout).sort()).toEqual(Object.keys(page.widgets).sort());
  });
});

describe("currencies in the portfolio", () => {
  it("never adds a non-dollar run into a dollar total", async () => {
    const usd = await run("documentary", true);
    const eur = structuredClone(usd);
    eur.id = "eur-run";
    eur.bundle = { ...eur.bundle!, currency: "EUR" };
    eur.payouts = { ...eur.payouts!, lines: eur.payouts!.lines.map((l) => ({ ...l, currency: "EUR" })) };

    const def = buildPortfolioData([usd, eur]);
    const rows = def.sources.find((x) => x.id === "runs")!.data;
    const [u, e] = [rows.find((r) => r.runId === usd.id)!, rows.find((r) => r.runId === "eur-run")!];
    expect(u).toMatchObject({ currency: "USD", verifiedTotal: 329, verifiedTotalLocal: 329 });
    expect(e).toMatchObject({ currency: "EUR", verifiedTotal: null, priceOnlyTotal: null, compliancePremium: null, verifiedTotalLocal: 329 });
    const lines = def.sources.find((x) => x.id === "payouts")!.data.filter((r) => r.runId === "eur-run");
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatchObject({ amount: null, currency: "EUR" });
  });
});
