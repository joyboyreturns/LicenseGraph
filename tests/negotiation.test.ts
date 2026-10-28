import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AGREED_SUFFIX, concede, negotiationOutlook } from "../src/core/negotiation";
import { evaluateOffer, verifyBundle } from "../src/core/rules";
import type { LicenseOffer, LicenseTerms, Project } from "../src/core/types";

const options = { today: "2026-11-05" };
const project: Project = { name: "P", commercial: true, territories: ["US", "CA"], termMonths: 12, budgetCents: 50_000, mediums: ["web", "print"], canCredit: false, needsSublicensing: true, requiresExclusive: true };

const offer = (id: string, assetId: string, priceCents: number, terms: Partial<LicenseTerms> = {}, currency = "USD"): LicenseOffer => ({
  id,
  assetId,
  priceCents,
  currency,
  terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24, mediums: "ALL", attributionRequired: false, sublicensing: true, exclusive: true, ...terms },
  evidence: [{ documentId: "d", quote: "q" }],
});
const failing = (o: LicenseOffer, p = project) => evaluateOffer(p, o, options).filter((r) => r.status === "fail").map((r) => r.rule);

describe("concede", () => {
  it("makes each askable rule pass and changes nothing else", () => {
    const bad = offer("o", "song", 10_000, { commercialUse: false, territories: ["US"], termMonths: 6, fixedEndDate: "2026-12-01", mediums: ["web"], attributionRequired: true, sublicensing: false, exclusive: false, offerValidUntil: "2026-01-01" });
    const rules = failing(bad);
    expect(rules.sort()).toEqual(["attribution", "commercial-use", "exclusivity", "expiry", "medium", "sublicensing", "term", "territory"]);
    const agreed = concede(project, bad, rules, options);
    expect(failing(agreed)).toEqual([]);
    expect(agreed.id).toBe(`o${AGREED_SUFFIX}`);
    expect(agreed.priceCents).toBe(10_000);
    expect(agreed.terms.territories).toEqual(["US", "CA"]);
    expect(agreed.terms.mediums).toEqual(["web", "print"]);
    expect(agreed.terms.termMonths).toBe(12);
    expect(bad.terms.commercialUse).toBe(false); // the original is untouched
  });

  it("only touches the rules it is told to", () => {
    const bad = offer("o", "song", 10_000, { commercialUse: false, exclusive: false });
    const agreed = concede(project, bad, ["exclusivity"], options);
    expect(agreed.terms.exclusive).toBe(true);
    expect(agreed.terms.commercialUse).toBe(false);
  });

  it("reaches a required end date", () => {
    const p: Project = { ...project, endDate: "2028-03-15" };
    const short = offer("o", "song", 10_000, { termMonths: 12 });
    expect(failing(short, p)).toContain("term");
    expect(evaluateOffer(p, concede(p, short, ["term"], options), options).some((r) => r.status === "fail")).toBe(false);
  });
});

describe("negotiationOutlook", () => {
  it("is absent when something can already be bought", () => {
    expect(negotiationOutlook(project, ["song"], [offer("ok", "song", 10_000)], "USD", options)).toBeUndefined();
  });

  it("prices the bundle as if the closest offers were changed, and says how far each could rise", () => {
    const candidates = [
      offer("song-near", "song", 10_000, { exclusive: false }),
      offer("song-far", "song", 5_000, { exclusive: false, sublicensing: false, commercialUse: false }),
      offer("image-ok", "image", 8_000),
    ];
    const out = negotiationOutlook(project, ["song", "image"], candidates, "USD", options)!;
    // Fewest changes wins as "closest", not the lowest price.
    expect(out.asked).toEqual(["song"]);
    expect(out.totalCents).toBe(18_000);
    expect(out.headroomCents).toBe(32_000);
    expect(out.assets.find((a) => a.assetId === "song")).toEqual({ assetId: "song", offerId: "song-near", priceCents: 10_000, ceilingCents: 42_000 });
    expect(out.assets.find((a) => a.assetId === "image")).toMatchObject({ offerId: "image-ok", ceilingCents: undefined });
  });

  it("reports negative headroom when even a yes to everything breaks the budget", () => {
    const out = negotiationOutlook({ ...project, budgetCents: 5_000 }, ["song"], [offer("s", "song", 10_000, { exclusive: false })], "USD", options)!;
    expect(out.headroomCents).toBe(-5_000);
    expect(out.assets[0]!.ceilingCents).toBe(5_000);
  });

  it("gives no ceiling when the project has no budget", () => {
    const out = negotiationOutlook({ ...project, budgetCents: undefined }, ["song"], [offer("s", "song", 10_000, { exclusive: false })], "USD", options)!;
    expect(out.headroomCents).toBeUndefined();
    expect(out.assets[0]!.ceilingCents).toBeUndefined();
  });

  it("is absent when asking cannot help: no offers, or a wrong currency", () => {
    expect(negotiationOutlook(project, ["song"], [], "USD", options)).toBeUndefined();
    expect(negotiationOutlook(project, ["song"], [offer("eur", "song", 10_000, {}, "EUR")], "USD", options)).toBeUndefined();
  });
});

const termsArb: fc.Arbitrary<LicenseTerms> = fc.record({
  commercialUse: fc.boolean(),
  territories: fc.subarray(["WORLD", "US", "CA", "GB"]),
  termMonths: fc.oneof(fc.constant("perpetual" as const), fc.integer({ min: 1, max: 60 })),
  mediums: fc.oneof(fc.constant(undefined), fc.constant("ALL" as const), fc.subarray(["web", "print", "audio"])),
  attributionRequired: fc.option(fc.boolean(), { nil: undefined }),
  sublicensing: fc.option(fc.boolean(), { nil: undefined }),
  exclusive: fc.option(fc.boolean(), { nil: undefined }),
  offerValidUntil: fc.option(fc.constantFrom("2026-01-01", "2027-01-01"), { nil: undefined }),
});

describe("negotiationOutlook properties", () => {
  let defined = 0;
  it("the best case it names is a bundle the verifier accepts, at exactly the total it states", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom("song", "image"), fc.integer({ min: 1, max: 30_000 }), termsArb), { minLength: 1, maxLength: 6 }), (rows) => {
        const candidates = rows.map(([asset, price, terms], i) => ({ ...offer(`o${i}`, asset, price), terms }));
        const required = ["song", "image"];
        const out = negotiationOutlook(project, required, candidates, "USD", options);
        if (!out) return;
        defined++;
        const sum = out.assets.reduce((n, a) => n + a.priceCents, 0);
        expect(sum).toBe(out.totalCents);
        // Rebuild the bundle: asked assets with their conceded terms, the rest as read.
        const bundle = out.assets.map((a) => {
          const real = candidates.find((c) => c.id === a.offerId)!;
          return out.asked.includes(a.assetId) ? concede(project, real, evaluateOffer(project, real, options).filter((r) => r.status === "fail").map((r) => r.rule), options) : real;
        });
        expect(verifyBundle({ ...project, budgetCents: undefined }, required, { offers: bundle }, options).ok).toBe(true);
        // A ceiling is exactly the room left: paying it keeps the total on the budget, one cent more breaks it.
        for (const a of out.assets) {
          if (a.ceilingCents === undefined) continue;
          expect(out.totalCents - a.priceCents + a.ceilingCents).toBe(project.budgetCents);
        }
      }),
      { numRuns: 300 },
    );
    expect(defined).toBeGreaterThan(30); // the property is not passing by never having an outlook to check
  });
});
