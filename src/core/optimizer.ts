import { evaluateOffer, verifyBundle, type VerifyOptions } from "./rules";
import type { LicenseOffer, Project } from "./types";

export interface CostPlan {
  currency: string;
  offerIds: string[];
  totalCents: number;
  budgetShortfallCents: number;
  /** Exact number of compliant combinations in this currency, before the budget check. */
  compliantCombinations: string;
}

export interface CostFrontier {
  plans: CostPlan[];
  uncoveredAssets: string[];
  candidateCombinations: string;
}

/**
 * Exact minimum for the current independent per-offer rules: choose the cheapest compliant
 * offer per asset, separately in each currency. No exponential bundle enumeration or model
 * calls. Every result is checked by verifyBundle again; currencies are never compared by FX.
 * If future rules couple offers (e.g. bundle discounts), this separability must be revisited.
 */
export function minimumCompliantCost(project: Project, requiredAssetIds: string[], candidates: LicenseOffer[], options: VerifyOptions = {}): CostFrontier {
  const required = [...new Set(requiredAssetIds)].sort();
  const empty: CostFrontier = { plans: [], uncoveredAssets: required, candidateCombinations: "0" };
  if (!required.length || new Set(candidates.map((o) => o.id)).size !== candidates.length) return empty;
  const relevant = candidates.filter((o) => required.includes(o.assetId));
  let combinations = 1n;
  for (const asset of required) combinations *= BigInt(relevant.filter((o) => o.assetId === asset).length);
  const compliant = relevant.filter((o) => Number.isSafeInteger(o.priceCents) && o.priceCents > 0 && evaluateOffer(project, o, options).every((r) => r.status !== "fail"));
  const uncoveredAssets = required.filter((asset) => !compliant.some((o) => o.assetId === asset));
  const plans: CostPlan[] = [];
  for (const currency of [...new Set(compliant.map((o) => o.currency))].sort()) {
    const offers: LicenseOffer[] = [];
    let count = 1n;
    for (const asset of required) {
      const choices = compliant.filter((o) => o.assetId === asset && o.currency === currency)
        .sort((a, b) => a.priceCents - b.priceCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      count *= BigInt(choices.length);
      if (choices[0]) offers.push(choices[0]);
    }
    // Compute the rights-compliant floor without silently relaxing any rights constraints.
    const verdict = verifyBundle({ ...project, budgetCents: undefined }, required, { offers }, options);
    if (!verdict.ok || !Number.isSafeInteger(verdict.totalCents)) continue;
    plans.push({ currency, offerIds: offers.map((o) => o.id), totalCents: verdict.totalCents, budgetShortfallCents: Math.max(0, verdict.totalCents - (project.budgetCents ?? verdict.totalCents)), compliantCombinations: count.toString() });
  }
  return { plans, uncoveredAssets, candidateCombinations: combinations.toString() };
}
