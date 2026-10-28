import { evaluateOffer, type RuleResult, type VerifyOptions } from "./rules";
import type { Cents, LicenseOffer, Project } from "./types";
import { gapRequests, requirementCosts, type GapRequest, type RequirementCosts } from "./insights";
import { minimumCompliantCost, type CostFrontier } from "./optimizer";

export interface OfferEvaluation {
  offerId: string;
  assetId: string;
  priceCents: Cents;
  results: RuleResult[];
  /** True when no rule failed for this offer on its own. */
  compliant: boolean;
  /** In the verified bundle. */
  chosen: boolean;
}

export interface AssetAnalysis {
  assetId: string;
  chosenOfferId?: string;
  chosenCents?: Cents;
  /** What a price-only buyer would have picked for this asset. */
  cheapestOfferId: string;
  cheapestCents: Cents;
  /** The cheapest offer broke a rule, so a price-only buyer would have bought a licence they cannot use. */
  cheapestIsBlocked: boolean;
  blockedReasons: string[];
}

export interface RunAnalysis {
  optimization: CostFrontier;
  /** What each declared requirement adds to the minimum compliant cost. Absent when no complete compliant bundle exists. */
  requirementCosts?: RequirementCosts;
  /** Assets with no compliant offer: the nearest offer and what to ask the licensor to change. */
  gaps: GapRequest[];
  evaluations: OfferEvaluation[];
  assets: AssetAnalysis[];
  /** Total of the cheapest offer per asset: what shopping on price alone would cost. */
  naiveTotalCents: Cents;
  chosenTotalCents: Cents;
  /** Extra paid over the price-only total to stay compliant (never negative). */
  compliancePremiumCents: Cents;
  /** Price-only picks that the rules would have blocked, and what they would have cost. */
  blockedPurchases: { assetId: string; offerId: string; priceCents: Cents; reasons: string[] }[];
}

/**
 * Compare the verified bundle with a price-only purchase. It states what was avoided without
 * inventing figures: every number here is a price from an uploaded licence.
 */
export function analyzeRun(input: { project: Project; requiredAssetIds: string[]; candidates: LicenseOffer[]; chosenOfferIds: string[]; options?: VerifyOptions }): RunAnalysis {
  const { project, requiredAssetIds, candidates, options } = input;
  const chosen = new Set(input.chosenOfferIds);

  const evaluations: OfferEvaluation[] = candidates.map((o) => {
    const results = evaluateOffer(project, o, options);
    return { offerId: o.id, assetId: o.assetId, priceCents: o.priceCents, results, compliant: results.every((r) => r.status !== "fail"), chosen: chosen.has(o.id) };
  });
  const byId = new Map(evaluations.map((e) => [e.offerId, e]));

  const assets: AssetAnalysis[] = [];
  for (const assetId of requiredAssetIds) {
    const options_ = candidates.filter((c) => c.assetId === assetId).sort((a, b) => a.priceCents - b.priceCents || a.id.localeCompare(b.id));
    const cheapest = options_[0];
    if (!cheapest) continue;
    const pick = options_.find((o) => chosen.has(o.id));
    const cheapestEval = byId.get(cheapest.id)!;
    assets.push({
      assetId,
      chosenOfferId: pick?.id,
      chosenCents: pick?.priceCents,
      cheapestOfferId: cheapest.id,
      cheapestCents: cheapest.priceCents,
      cheapestIsBlocked: !cheapestEval.compliant,
      blockedReasons: cheapestEval.results.filter((r) => r.status === "fail").flatMap((r) => r.messages),
    });
  }

  const naiveTotalCents = assets.reduce((n, a) => n + a.cheapestCents, 0);
  const chosenTotalCents = assets.reduce((n, a) => n + (a.chosenCents ?? 0), 0);
  return {
    optimization: minimumCompliantCost(project, requiredAssetIds, candidates, options),
    requirementCosts: requirementCosts(project, requiredAssetIds, candidates, options),
    gaps: gapRequests(project, requiredAssetIds, candidates, options),
    evaluations,
    assets,
    naiveTotalCents,
    chosenTotalCents,
    compliancePremiumCents: Math.max(0, chosenTotalCents - naiveTotalCents),
    blockedPurchases: assets.filter((a) => a.cheapestIsBlocked).map((a) => ({ assetId: a.assetId, offerId: a.cheapestOfferId, priceCents: a.cheapestCents, reasons: a.blockedReasons })),
  };
}
