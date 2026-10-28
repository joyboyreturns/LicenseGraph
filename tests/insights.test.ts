import { describe, expect, it } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { createSession, runPipeline } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarios } from "../src/demo/scenarios";
import { analyzeRun } from "../src/core/analysis";
import { draftLicensorMessage, gapRequests, requirementCosts } from "../src/core/insights";
import { verifyBundle } from "../src/core/rules";
import type { LicenseOffer, Project, RuleId } from "../src/core/types";

const options = { today: "2026-11-05" };

async function candidatesOf(id: string) {
  const sc = scenarios.find((s) => s.id === id)!;
  const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
  await runPipeline(s, { model: demoModel, proposer: greedyProposer, today: () => options.today });
  return { project: sc.project, required: sc.requiredAssetIds, candidates: s.candidates };
}

/** The slow, obviously correct answer: try every bundle and ask the real verifier which rules it breaks. */
function bruteForce(project: Project, required: string[], candidates: LicenseOffer[], relaxed: RuleId | undefined) {
  let best: number | undefined;
  const choose = (i: number, picked: LicenseOffer[]) => {
    if (i === required.length) {
      const verdict = verifyBundle({ ...project, budgetCents: undefined }, required, { offers: picked }, options);
      if (verdict.violations.every((v) => v.rule === relaxed)) best = Math.min(best ?? Infinity, verdict.totalCents);
      return;
    }
    for (const o of candidates.filter((c) => c.assetId === required[i])) choose(i + 1, [...picked, o]);
  };
  choose(0, []);
  return best;
}

describe("requirementCosts", () => {
  it.each(scenarios.map((s) => s.id))("matches an exhaustive search of every bundle: %s", async (id) => {
    const { project, required, candidates } = await candidatesOf(id);
    const result = requirementCosts(project, required, candidates, options)!;
    expect(result.baselineCents).toBe(bruteForce(project, required, candidates, undefined));
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.withoutCents, item.rule).toBe(bruteForce(project, required, candidates, item.rule));
      expect(item.extraCents).toBe(result.baselineCents - item.withoutCents);
    }
  });

  it("names what each requirement costs in the game trailer, most expensive first", async () => {
    const { project, required, candidates } = await candidatesOf("game-trailer");
    const r = requirementCosts(project, required, candidates, options)!;
    expect(r.currency).toBe("USD");
    expect(r.items.slice(0, 2).map((i) => [i.rule, i.extraCents])).toEqual([["medium", 96_000], ["commercial-use", 44_000]]);
    expect(r.items.map((i) => i.extraCents)).toEqual([...r.items.map((i) => i.extraCents)].sort((a, b) => b - a));
  });

  it("only lists requirements the project declares", async () => {
    const { project, required, candidates } = await candidatesOf("documentary");
    const rules = requirementCosts(project, required, candidates, options)!.items.map((i) => i.rule);
    expect(rules).not.toContain("medium");
    expect(rules).not.toContain("sublicensing");
    expect(rules).toContain("commercial-use");
  });

  it("is absent when no compliant bundle exists", async () => {
    const { project, required, candidates } = await candidatesOf("podcast");
    expect(requirementCosts({ ...project, requiresExclusive: true }, required, candidates, options)).toBeUndefined();
  });
});

describe("gapRequests", () => {
  it("is empty when every asset has a compliant offer", async () => {
    const { project, required, candidates } = await candidatesOf("podcast");
    expect(gapRequests(project, required, candidates, options)).toEqual([]);
  });

  it("finds the nearest offer per blocked asset and what to ask for", async () => {
    const { project, required, candidates } = await candidatesOf("podcast");
    const strict = { ...project, requiresExclusive: true };
    const gaps = gapRequests(strict, required, candidates, options);
    expect(gaps.map((g) => g.assetId).sort()).toEqual([...required].sort());
    for (const gap of gaps) {
      const offer = candidates.find((c) => c.id === gap.offerId)!;
      expect(offer.assetId).toBe(gap.assetId);
      expect(gap.asks.map((a) => a.rule)).toContain("exclusivity");
      // The chosen offer is no worse than any other for that asset.
      const fails = (o: LicenseOffer) => verifyBundle({ ...strict, budgetCents: undefined }, [o.assetId], { offers: [o] }, options).violations.length;
      for (const other of candidates.filter((c) => c.assetId === gap.assetId)) expect(fails(offer)).toBeLessThanOrEqual(fails(other));
    }
  });

  it("is reported with the run analysis, and drafts a message built from the run's own facts", async () => {
    const { project, required, candidates } = await candidatesOf("podcast");
    const strict = { ...project, requiresExclusive: true };
    const analysis = analyzeRun({ project: strict, requiredAssetIds: required, candidates, chosenOfferIds: [], options });
    expect(analysis.requirementCosts).toBeUndefined();
    expect(analysis.gaps).toHaveLength(required.length);

    const gap = analysis.gaps[0]!;
    const { subject, body } = draftLicensorMessage(strict, gap, "Pixel Hymns");
    expect(subject).toContain(strict.name);
    expect(body).toContain("Hello Pixel Hymns,");
    expect(body).toContain("Make the licence exclusive.");
    expect(body).toContain(`${(gap.priceCents / 100).toFixed(2)} ${gap.currency}`);
  });

  it("asks for the specific missing terms, not a generic request", () => {
    const offer: LicenseOffer = {
      id: "o1", assetId: "song", priceCents: 10_000, currency: "USD",
      terms: { commercialUse: false, territories: ["US"], termMonths: 6, mediums: ["web"], attributionRequired: true },
      evidence: [{ documentId: "d", quote: "q" }],
    };
    const project: Project = { name: "P", commercial: true, territories: ["WORLD"], termMonths: 24, mediums: ["web", "broadcast"], canCredit: false };
    const [gap] = gapRequests(project, ["song"], [offer], options);
    expect(gap!.asks.map((a) => a.rule).sort()).toEqual(["attribution", "commercial-use", "medium", "term", "territory"]);
    const text = gap!.asks.map((a) => a.ask).join("\n");
    expect(text).toContain("Cover worldwide (the offer covers US).");
    expect(text).toContain("at least 24 months (the offer is 6 months");
    expect(text).toContain("Add broadcast to the covered media.");
  });
});
