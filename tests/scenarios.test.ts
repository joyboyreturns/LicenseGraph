import { describe, expect, it } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { createSession, runPipeline, viewOf, type Deps } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById, scenarios } from "../src/demo/scenarios";
import { negotiationOutlook } from "../src/core/negotiation";
import { parseBriefLocally } from "../src/intake/brief";

const deps: Deps = { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05" };

const run = async (id: string) => {
  const sc = scenarioById(id)!;
  const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })), meta: { scenarioId: id } });
  await runPipeline(s, deps);
  return { sc, s, view: viewOf(s) };
};

describe("scenarios", () => {
  it("has unique ids, and every document is named by a licensor", () => {
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
    for (const sc of scenarios) {
      expect(new Set(sc.documents.map((d) => d.id)).size).toBe(sc.documents.length);
      expect(sc.documents.every((d) => d.licensor?.name && d.licensor.email)).toBe(true);
      expect(sc.requiredAssetIds.every((a) => sc.documents.some((d) => d.assetId === a))).toBe(true);
    }
  });

  it.each(scenarios.filter((s) => !s.noBundle).map((s) => s.id))("%s reads every licence, and a compliant bundle is found after at least one rejection", async (id) => {
    const { sc, s, view } = await run(id);
    expect(s.candidates).toHaveLength(sc.documents.length);
    expect(view.loopStatus).toBe("verified");
    expect(view.rounds).toBeGreaterThanOrEqual(2);
    expect(view.events.map((e) => e.kind)).toContain("rejected");
    expect(view.analysis!.blockedPurchases.length).toBeGreaterThan(0);
  });

  it("the exclusive theme has no compliant bundle, says what to ask for, and prices a yes", async () => {
    const { sc, s, view } = await run("exclusive-theme");
    expect(sc.noBundle).toBe(true);
    expect(s.candidates).toHaveLength(sc.documents.length);
    expect(view.bundle).toBeUndefined();
    expect(view.loopStatus).not.toBe("verified");
    expect(view.analysis!.gaps.map((g) => g.assetId).sort()).toEqual(["image", "song", "voiceover"]);
    for (const gap of view.analysis!.gaps) expect(gap.asks.map((a) => a.rule)).toEqual(["exclusivity"]);
    const out = negotiationOutlook(view.project, sc.requiredAssetIds, s.candidates, "USD", { today: "2026-11-05" })!;
    expect(out.totalCents).toBe(34_000 + 14_000 + 21_000);
    expect(out.headroomCents).toBe(150_000 - 69_000);
    // Only the exclusive-making change is hypothetical: the cheaper non-network offers still fail on other rules.
    expect(out.assets.map((a) => a.offerId).sort()).toEqual(["offer-pod-art-network", "offer-pod-song-network", "offer-pod-voice-long"]);
  });

  it("the game trailer takes three rounds and trips five different rules", async () => {
    const { view } = await run("game-trailer");
    expect(view.rounds).toBe(3);
    const rules = new Set(view.events.filter((e) => e.kind === "rejected").flatMap((e) => (e.payload.violations as { rule: string }[]).map((v) => v.rule)));
    expect([...rules].sort()).toEqual(["commercial-use", "expiry", "medium", "term", "territory"]);
    expect(view.bundle!.offers.map((o) => o.id)).toEqual(["offer-trailer-song-pro", "offer-trailer-art-all", "offer-trailer-sfx-std"]);
    expect(view.bundle!.totalCents).toBe(160_000 + 48_000 + 9_000);
  });

  it("the podcast network is decided by credit, sublicensing, region and term", async () => {
    const { view } = await run("podcast");
    const rules = new Set(view.events.filter((e) => e.kind === "rejected").flatMap((e) => (e.payload.violations as { rule: string }[]).map((v) => v.rule)));
    expect([...rules].sort()).toEqual(["attribution", "sublicensing", "term", "territory"]);
    expect(view.bundle!.offers.map((o) => o.id)).toEqual(["offer-pod-song-network", "offer-pod-art-network", "offer-pod-voice-long"]);
  });

  it("every scenario's brief reads back to its project's key constraints", () => {
    for (const sc of scenarios) {
      const r = parseBriefLocally(sc.brief);
      expect(r.project.termMonths, sc.id).toBe(sc.project.termMonths);
      expect(r.project.commercial, sc.id).toBe(sc.project.commercial);
      expect(r.project.budgetCents, sc.id).toBe(sc.project.budgetCents);
      expect(r.project.territories.slice().sort(), sc.id).toEqual(sc.project.territories.slice().sort());
      expect(r.requiredAssetIds.slice().sort(), sc.id).toEqual(sc.requiredAssetIds.slice().sort());
    }
  });
});
