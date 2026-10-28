import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { createSession, runPipeline } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarios } from "../src/demo/scenarios";
import { verifyBundle } from "../src/core/rules";
import type { LicenseOffer, Project } from "../src/core/types";
import { applyChange, whatIf, type ProjectChange } from "../src/core/whatif";

const options = { today: "2026-11-05" };

async function run(id: string) {
  const sc = scenarios.find((s) => s.id === id)!;
  const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })) });
  await runPipeline(s, { model: demoModel, proposer: greedyProposer, today: () => options.today });
  return { project: sc.project as Project, required: [...sc.requiredAssetIds], candidates: s.candidates };
}
const runs = Object.fromEntries(await Promise.all(scenarios.map(async (s) => [s.id, await run(s.id)] as const)));

/** The slow, obviously correct answer: try every bundle and ask the real verifier. */
function bruteForce(project: Project, required: string[], candidates: LicenseOffer[]): number | undefined {
  let best: number | undefined;
  const choose = (i: number, picked: LicenseOffer[]) => {
    if (i === required.length) {
      const verdict = verifyBundle({ ...project, budgetCents: undefined }, required, { offers: picked }, options);
      if (verdict.ok) best = Math.min(best ?? Infinity, verdict.totalCents);
      return;
    }
    for (const o of candidates.filter((c) => c.assetId === required[i] && c.currency === "USD")) choose(i + 1, [...picked, o]);
  };
  choose(0, []);
  return best;
}

const changeArb: fc.Arbitrary<ProjectChange> = fc.record(
  {
    commercial: fc.boolean(),
    territories: fc.subarray(["WORLD", "US", "CA", "GB", "DE", "FR", "AU"], { minLength: 1 }),
    termMonths: fc.integer({ min: 1, max: 120 }),
    mediums: fc.subarray(["web", "social", "broadcast", "print", "audio", "film", "app"]),
    canCredit: fc.boolean(),
    needsSublicensing: fc.boolean(),
    requiresExclusive: fc.boolean(),
  },
  { requiredKeys: [] },
);

describe("applyChange", () => {
  const base: Project = { name: "P", commercial: true, territories: ["US"], termMonths: 12, budgetCents: 50_000, mediums: ["web"], canCredit: false };

  it("changes only what was asked for, and never the budget or name", () => {
    expect(applyChange(base, { termMonths: 24 })).toEqual({ ...base, termMonths: 24 });
    expect(applyChange(base, {})).toEqual(base);
    expect(applyChange(base, { commercial: false, territories: ["WORLD"] })).toMatchObject({ name: "P", budgetCents: 50_000, commercial: false, territories: ["WORLD"] });
  });

  it("clears a constraint when it is switched off, and sets it when switched on", () => {
    expect(applyChange(base, { mediums: [] }).mediums).toBeUndefined();
    expect(applyChange(base, { canCredit: true }).canCredit).toBeUndefined();
    expect(applyChange({ ...base, canCredit: undefined }, { canCredit: false }).canCredit).toBe(false);
    expect(applyChange(base, { needsSublicensing: true }).needsSublicensing).toBe(true);
    expect(applyChange({ ...base, requiresExclusive: true }, { requiresExclusive: false }).requiresExclusive).toBeUndefined();
  });

  it("ignores a change that would make the brief meaningless, and does not touch the original", () => {
    const copy = structuredClone(base);
    expect(applyChange(base, { termMonths: 0, territories: [] })).toEqual(base);
    expect(applyChange(base, { termMonths: 1.5 })).toEqual(base);
    expect(base).toEqual(copy);
  });
});

describe("whatIf", () => {
  it.each(scenarios.map((s) => s.id))("with no change it reproduces the brief's own cheapest bundle: %s", (id) => {
    const { project, required, candidates } = runs[id]!;
    const r = whatIf(project, {}, required, candidates, "USD", options);
    expect(r.baselineCents).toBeDefined();
    expect(r.totalCents).toBe(r.baselineCents);
    expect(r.deltaCents).toBe(0);
    expect(r.shifts).toEqual([]);
    expect(r.uncoveredAssets).toEqual([]);
  });

  it.each(scenarios.map((s) => s.id))("matches an exhaustive search of every bundle for any change to the brief: %s", (id) => {
    const { project, required, candidates } = runs[id]!;
    fc.assert(
      fc.property(changeArb, (change) => {
        const r = whatIf(project, change, required, candidates, "USD", options);
        expect(r.totalCents).toBe(bruteForce(applyChange(project, change), required, candidates));
      }),
      { numRuns: 120 },
    );
  });

  it.each(scenarios.map((s) => s.id))("relaxing a requirement never costs more, tightening never costs less: %s", (id) => {
    const { project, required, candidates } = runs[id]!;
    const cost = (c: ProjectChange) => whatIf(project, c, required, candidates, "USD", options).totalCents ?? Infinity;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 }), (a, b) => {
        const [short, long] = a <= b ? [a, b] : [b, a];
        expect(cost({ termMonths: short })).toBeLessThanOrEqual(cost({ termMonths: long }));
      }),
    );
    for (const flag of ["needsSublicensing", "requiresExclusive"] as const) expect(cost({ [flag]: false })).toBeLessThanOrEqual(cost({ [flag]: true }));
    expect(cost({ commercial: false })).toBeLessThanOrEqual(cost({ commercial: true }));
    expect(cost({ canCredit: true })).toBeLessThanOrEqual(cost({ canCredit: false }));
    expect(cost({ mediums: [] })).toBeLessThanOrEqual(cost({ mediums: ["web", "social", "broadcast"] }));
  });

  it("explains a change that leaves an asset with nothing: which asset, and what to ask the licensor", () => {
    const { project, required, candidates } = runs.documentary!;
    const r = whatIf(project, { needsSublicensing: true, requiresExclusive: true }, required, candidates, "USD", options);
    expect(r.totalCents).toBeUndefined();
    expect(r.deltaCents).toBeUndefined();
    expect(r.uncoveredAssets.length).toBeGreaterThan(0);
    expect(r.gaps.map((g) => g.assetId).sort()).toEqual([...r.uncoveredAssets].sort());
    expect(r.gaps.every((g) => g.asks.length > 0)).toBe(true);
    for (const id of r.uncoveredAssets) expect(r.shifts.find((s) => s.assetId === id)).toMatchObject({ toOfferId: undefined });
  });

  it("names the asset whose pick changes, with both prices", () => {
    const { project, required, candidates } = runs.documentary!;
    const r = whatIf(project, { commercial: false }, required, candidates, "USD", options);
    expect(r.deltaCents).toBeLessThan(0);
    const shift = r.shifts[0]!;
    expect(shift.fromOfferId).toBeDefined();
    expect(shift.toOfferId).not.toBe(shift.fromOfferId);
    expect(shift.toCents!).toBeLessThan(shift.fromCents!);
    expect(r.deltaCents).toBe(r.shifts.reduce((n, s) => n + (s.toCents! - s.fromCents!), 0));
  });

  it("reports a budget the changed brief no longer fits", () => {
    const { project, required, candidates } = runs.documentary!;
    const tight = { ...project, budgetCents: 100 };
    expect(whatIf(tight, {}, required, candidates, "USD", options).budgetShortfallCents).toBeGreaterThan(0);
  });
});
