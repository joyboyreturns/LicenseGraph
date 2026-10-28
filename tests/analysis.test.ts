import { describe, expect, it } from "vitest";
import { analyzeRun } from "../src/core/analysis";
import { evaluateOffer, RULE_CATALOG } from "../src/core/rules";
import type { LicenseOffer, Project } from "../src/core/types";

const project: Project = { name: "Ad", commercial: true, territories: ["US"], termMonths: 12 };
const offer = (id: string, assetId: string, priceCents: number, terms: Partial<LicenseOffer["terms"]> = {}): LicenseOffer => ({
  id,
  assetId,
  priceCents,
  currency: "USD",
  terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24, ...terms },
  evidence: [{ documentId: id, quote: "q" }],
});

const status = (project_: Project, o: LicenseOffer, today?: string) => Object.fromEntries(evaluateOffer(project_, o, { today }).map((r) => [r.rule, r.status]));

describe("evaluateOffer", () => {
  it("reports every rule in the catalogue, in order", () => {
    expect(evaluateOffer(project, offer("a", "x", 1)).map((r) => r.rule)).toEqual(RULE_CATALOG.map((r) => r.id));
  });

  it("marks rules the brief does not declare as skipped, and the rest as passed", () => {
    expect(status(project, offer("a", "x", 1))).toEqual({
      "commercial-use": "pass", territory: "pass", term: "pass", medium: "skip", attribution: "skip", sublicensing: "skip", exclusivity: "skip", expiry: "skip", evidence: "pass", amount: "pass", currency: "pass",
    });
  });

  it("marks a broken rule as failed with the reason", () => {
    const results = evaluateOffer(project, offer("a", "x", 1, { commercialUse: false }));
    expect(results.find((r) => r.rule === "commercial-use")).toMatchObject({ status: "fail", messages: ["Licence does not allow commercial use."] });
  });

  it("runs declared constraints and expiry only when they apply", () => {
    const strict: Project = { ...project, mediums: ["web"], needsSublicensing: true, requiresExclusive: true, canCredit: false };
    const s = status(strict, offer("a", "x", 1, { offerValidUntil: "2026-11-01" }), "2026-11-02");
    expect(s).toMatchObject({ medium: "fail", attribution: "fail", sublicensing: "fail", exclusivity: "fail", expiry: "fail" });
    expect(status(project, offer("a", "x", 1, { offerValidUntil: "2026-11-01" }), "2026-10-30").expiry).toBe("pass");
  });
});

describe("analyzeRun", () => {
  const candidates = [offer("song-personal", "song", 2_000, { commercialUse: false }), offer("song-pro", "song", 20_000), offer("font", "font", 4_900)];
  const run = analyzeRun({ project, requiredAssetIds: ["song", "font"], candidates, chosenOfferIds: ["song-pro", "font"] });

  it("evaluates every candidate, not only the chosen bundle", () => {
    expect(run.evaluations.map((e) => [e.offerId, e.compliant, e.chosen])).toEqual([["song-personal", false, false], ["song-pro", true, true], ["font", true, true]]);
  });

  it("compares with a price-only purchase and says what would have been blocked", () => {
    expect(run.naiveTotalCents).toBe(2_000 + 4_900);
    expect(run.chosenTotalCents).toBe(24_900);
    expect(run.compliancePremiumCents).toBe(18_000);
    expect(run.blockedPurchases).toEqual([{ assetId: "song", offerId: "song-personal", priceCents: 2_000, reasons: ["Licence does not allow commercial use."] }]);
    expect(run.assets[0]).toMatchObject({ assetId: "song", chosenOfferId: "song-pro", cheapestOfferId: "song-personal", cheapestIsBlocked: true });
  });

  it("has no premium and nothing blocked when the cheapest offers are compliant", () => {
    const easy = analyzeRun({ project, requiredAssetIds: ["font"], candidates: [offer("font", "font", 4_900)], chosenOfferIds: ["font"] });
    expect(easy).toMatchObject({ compliancePremiumCents: 0, blockedPurchases: [] });
  });

  it("handles a run with nothing chosen", () => {
    const none = analyzeRun({ project, requiredAssetIds: ["song"], candidates: [candidates[0]!], chosenOfferIds: [] });
    expect(none.chosenTotalCents).toBe(0);
    expect(none.assets[0]).toMatchObject({ chosenOfferId: undefined, cheapestIsBlocked: true });
  });

  it("skips assets with no candidate offers", () => {
    expect(analyzeRun({ project, requiredAssetIds: ["ghost"], candidates, chosenOfferIds: [] }).assets).toEqual([]);
  });
});
