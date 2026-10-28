import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compareRuns, type RunOutcome } from "../src/core/compare";
import type { LicenseOffer } from "../src/core/types";

const offer = (id: string, assetId: string, priceCents: number): LicenseOffer => ({ id, assetId, priceCents, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 12 }, evidence: [] });
const outcome = (...offers: LicenseOffer[]): RunOutcome => ({ offers, totalCents: offers.reduce((n, o) => n + o.priceCents, 0), currency: "USD" });

describe("compareRuns", () => {
  it("names what changed per asset and the difference in the total", () => {
    const before = outcome(offer("s1", "song", 20_000), offer("i1", "image", 5_000), offer("v1", "voice", 9_000));
    const after = outcome(offer("s2", "song", 14_000), offer("i1", "image", 5_000), offer("v2", "voice", 9_000));
    const r = compareRuns(before, after);
    expect(r.assets.map((a) => [a.assetId, a.change])).toEqual([["image", "same"], ["song", "cheaper"], ["voice", "other-licence"]]);
    expect(r.deltaCents).toBe(-6_000);
    expect(r.currency).toBe("USD");
  });

  it("says dearer when the new licence costs more", () => {
    expect(compareRuns(outcome(offer("a", "song", 100)), outcome(offer("b", "song", 150))).assets[0]!.change).toBe("dearer");
  });

  it("reads a run that bought nothing as gained or lost, with no total to compare", () => {
    const some = outcome(offer("a", "song", 100));
    expect(compareRuns(undefined, some)).toMatchObject({ assets: [{ assetId: "song", change: "gained" }], deltaCents: null });
    expect(compareRuns(some, undefined)).toMatchObject({ assets: [{ assetId: "song", change: "lost" }], deltaCents: null });
  });

  it("does not subtract totals in different currencies", () => {
    const eur = { ...outcome(offer("a", "song", 100)), currency: "EUR" };
    expect(compareRuns(outcome(offer("a", "song", 100)), eur).deltaCents).toBeNull();
  });
});

describe("compareRuns, for any two bundles", () => {
  const assetIds = ["song", "image", "font", "voice"];
  const bundle = fc
    .uniqueArray(fc.constantFrom(...assetIds), { maxLength: 4 })
    .chain((ids) => fc.tuple(...ids.map((assetId) => fc.record({ id: fc.constantFrom("a", "b", "c"), price: fc.integer({ min: 1, max: 100_000 }) }).map((o) => offer(`${assetId}-${o.id}`, assetId, o.price)))))
    .map((offers) => outcome(...offers));

  it("covers every asset of either run once, and its delta is exactly the difference of the totals", () => {
    fc.assert(
      fc.property(bundle, bundle, (before, after) => {
        const r = compareRuns(before, after);
        const expected = [...new Set([...before.offers, ...after.offers].map((o) => o.assetId))].sort();
        expect(r.assets.map((a) => a.assetId)).toEqual(expected);
        expect(r.deltaCents).toBe(after.totalCents - before.totalCents);
        // The per-asset prices explain the delta: nothing moved that the rows do not show.
        const rows = r.assets.reduce((n, a) => n + (a.after?.priceCents ?? 0) - (a.before?.priceCents ?? 0), 0);
        expect(rows).toBe(r.deltaCents);
      }),
    );
  });

  it("calls an unchanged run the same, and swapping the runs swaps cheaper and dearer", () => {
    fc.assert(
      fc.property(bundle, bundle, (a, b) => {
        expect(compareRuns(a, a).assets.every((x) => x.change === "same")).toBe(true);
        const flip: Record<string, string> = { cheaper: "dearer", dearer: "cheaper", gained: "lost", lost: "gained", same: "same", "other-licence": "other-licence" };
        expect(compareRuns(b, a).assets.map((x) => x.change)).toEqual(compareRuns(a, b).assets.map((x) => flip[x.change]));
      }),
    );
  });
});
