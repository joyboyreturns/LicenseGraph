import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { minimumCompliantCost } from "../src/core/optimizer";
import { verifyBundle } from "../src/core/rules";
import type { LicenseOffer, Project } from "../src/core/types";

const project: Project = { name: "Trailer", commercial: true, territories: ["WORLD"], termMonths: 12 };
const offer = (id: string, assetId: string, priceCents: number, currency = "USD", commercialUse = true): LicenseOffer => ({
  id, assetId, priceCents, currency,
  terms: { commercialUse, territories: ["WORLD"], termMonths: 12 },
  evidence: [{ documentId: id, quote: "q" }],
});

describe("independent cost frontier", () => {
  it("finds the exact minimum without choosing a cheaper rights violation", () => {
    const result = minimumCompliantCost(project, ["a", "b"], [offer("trap", "a", 1, "USD", false), offer("a", "a", 100), offer("expensive", "a", 300), offer("b", "b", 200)]);
    expect(result).toMatchObject({ candidateCombinations: "3", uncoveredAssets: [], plans: [{ totalCents: 300, offerIds: ["a", "b"], budgetShortfallCents: 0, compliantCombinations: "2" }] });
  });

  it("explains the exact budget gap without silently relaxing rights", () => {
    const result = minimumCompliantCost({ ...project, budgetCents: 99 }, ["a"], [offer("a", "a", 100)]);
    expect(result.plans[0]).toMatchObject({ totalCents: 100, budgetShortfallCents: 1 });
    expect(verifyBundle({ ...project, budgetCents: 99 }, ["a"], { offers: [offer("a", "a", 100)] }).ok).toBe(false);
  });

  it("never mixes currencies or invents an FX comparison", () => {
    const result = minimumCompliantCost(project, ["a", "b"], [offer("a-us", "a", 100), offer("a-eu", "a", 50, "EUR"), offer("b-us", "b", 200), offer("b-eu", "b", 300, "EUR")]);
    expect(result.plans.map((p) => [p.currency, p.totalCents])).toEqual([["EUR", 350], ["USD", 300]]);
    expect(minimumCompliantCost(project, ["a", "b"], [offer("a", "a", 100), offer("b", "b", 100, "EUR")]).plans).toEqual([]);
  });

  it("reports missing coverage and ignores unrelated cheap offers", () => {
    const result = minimumCompliantCost(project, ["a", "b"], [offer("a", "a", 100), offer("x", "unneeded", 1)]);
    expect(result).toMatchObject({ plans: [], uncoveredAssets: ["b"], candidateCombinations: "0" });
  });

  it("breaks ties deterministically and refuses ambiguous offer ids", () => {
    const offers = [offer("z", "a", 100), offer("a", "a", 100)];
    expect(minimumCompliantCost(project, ["a"], offers)).toEqual(minimumCompliantCost(project, ["a"], [...offers].reverse()));
    expect(minimumCompliantCost(project, ["a"], offers).plans[0]!.offerIds).toEqual(["a"]);
    expect(minimumCompliantCost(project, ["a"], [offers[0]!, offers[0]!]).plans).toEqual([]);
  });

  it("matches exhaustive verification across generated catalogues", () => {
    fc.assert(fc.property(fc.array(fc.record({ price: fc.integer({ min: 1, max: 10000 }), commercial: fc.boolean(), currency: fc.constantFrom("USD", "EUR") }), { minLength: 4, maxLength: 10 }), (specs) => {
      const offers = specs.map((s, i) => offer(`o${i}`, i % 2 ? "b" : "a", s.price, s.currency, s.commercial));
      const result = minimumCompliantCost(project, ["a", "b"], offers);
      for (const currency of ["USD", "EUR"]) {
        const totals: number[] = [];
        for (const a of offers.filter((o) => o.assetId === "a" && o.currency === currency)) {
          for (const b of offers.filter((o) => o.assetId === "b" && o.currency === currency)) {
            const verdict = verifyBundle(project, ["a", "b"], { offers: [a, b] });
            if (verdict.ok) totals.push(verdict.totalCents);
          }
        }
        const plan = result.plans.find((p) => p.currency === currency);
        if (totals.length) {
          expect(plan?.totalCents).toBe(Math.min(...totals));
          expect(plan?.compliantCombinations).toBe(String(totals.length));
        } else expect(plan).toBeUndefined();
      }
    }), { numRuns: 250 });
  });
});
