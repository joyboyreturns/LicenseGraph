import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { verifyBundle } from "../src/core/rules";
import type { LicenseOffer, Project } from "../src/core/types";

const country = fc.constantFrom("US", "IN", "CA", "GB", "DE", "JP");
const countries = fc.uniqueArray(country, { minLength: 1, maxLength: 4 });
const months = fc.integer({ min: 1, max: 120 });

const project = (territories: string[], termMonths: number): Project => ({ name: "p", commercial: false, territories, termMonths });
const offer = (territories: string[], termMonths: number | "perpetual", id = "o1"): LicenseOffer => ({
  id,
  assetId: "a",
  priceCents: 100,
  currency: "USD",
  terms: { commercialUse: true, territories, termMonths },
  evidence: [{ documentId: "d", quote: "q" }],
});
const rulesFor = (p: Project, o: LicenseOffer) => verifyBundle(p, ["a"], { offers: [o] }).violations.map((v) => v.rule);

describe("territory", () => {
  it("a WORLD licence covers any project territories", () => {
    fc.assert(fc.property(countries, months, (t, m) => !rulesFor(project(t, m), offer(["WORLD"], m)).includes("territory")));
  });
  it("a licence covers any subset of the countries it lists", () => {
    fc.assert(
      fc.property(countries, fc.nat(), (listed, k) => {
        const subset = listed.slice(0, (k % listed.length) + 1);
        return !rulesFor(project(subset, 1), offer(listed, 1)).includes("territory");
      }),
    );
  });
  it("a named-country licence never covers a WORLD project", () => {
    fc.assert(fc.property(countries, (listed) => rulesFor(project(["WORLD"], 1), offer(listed, 1)).includes("territory")));
  });
  it("fails exactly when a needed country is missing", () => {
    fc.assert(
      fc.property(countries, countries, (needed, listed) => {
        const missing = needed.some((c) => !listed.includes(c));
        return rulesFor(project(needed, 1), offer(listed, 1)).includes("territory") === missing;
      }),
    );
  });
});

describe("term", () => {
  it("perpetual always satisfies any term", () => {
    fc.assert(fc.property(months, (m) => !rulesFor(project(["US"], m), offer(["WORLD"], "perpetual")).includes("term")));
  });
  it("fails exactly when the licence is shorter than the project", () => {
    fc.assert(fc.property(months, months, (have, need) => rulesFor(project(["US"], need), offer(["WORLD"], have)).includes("term") === have < need));
  });
});

describe("bundle", () => {
  it("the verdict does not depend on offer order", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ n: fc.nat(5), have: months }), { minLength: 1, maxLength: 5 }), (specs) => {
        const offers = specs.map((s, i) => ({ ...offer(["US"], s.have, `o${i}`), assetId: `a${i}` }));
        const required = offers.map((o) => o.assetId);
        const p = project(["US"], 60);
        const a = verifyBundle(p, required, { offers });
        const b = verifyBundle(p, required, { offers: [...offers].reverse() });
        expect(a.ok).toBe(b.ok);
        expect(a.totalCents).toBe(b.totalCents);
        expect(a.violations.map((v) => v.rule + v.assetId).sort()).toEqual(b.violations.map((v) => v.rule + v.assetId).sort());
      }),
    );
  });
  it("ok is true exactly when there are no violations", () => {
    fc.assert(fc.property(countries, countries, months, months, (n, l, have, need) => {
      const v = verifyBundle(project(n, need), ["a"], { offers: [offer(l, have)] });
      return v.ok === (v.violations.length === 0);
    }));
  });
});
