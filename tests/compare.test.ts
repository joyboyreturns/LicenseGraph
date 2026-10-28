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
