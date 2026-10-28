import { gapRequests, type GapRequest } from "./insights";
import { minimumCompliantCost } from "./optimizer";
import type { VerifyOptions } from "./rules";
import type { LicenseOffer, Project } from "./types";

/**
 * "What if the project changed?" Re-runs the exact cost check on a changed copy of the brief, using
 * the offers already read from the licences. Nothing is estimated and no model is involved, so a
 * figure here is what the rules engine would accept if the brief really said this.
 */

/** The parts of a brief a person might change. Absent fields keep the brief's own value. */
export interface ProjectChange {
  commercial?: boolean;
  territories?: string[];
  termMonths?: number;
  /** An empty list means the project does not constrain media. */
  mediums?: string[];
  canCredit?: boolean;
  needsSublicensing?: boolean;
  requiresExclusive?: boolean;
}

export function applyChange(project: Project, change: ProjectChange): Project {
  const next: Project = { ...project };
  if (change.commercial !== undefined) next.commercial = change.commercial;
  if (change.territories?.length) next.territories = [...change.territories];
  if (change.termMonths !== undefined && Number.isInteger(change.termMonths) && change.termMonths > 0) next.termMonths = change.termMonths;
  if (change.mediums !== undefined) next.mediums = change.mediums.length ? [...change.mediums] : undefined;
  if (change.canCredit !== undefined) next.canCredit = change.canCredit ? undefined : false;
  if (change.needsSublicensing !== undefined) next.needsSublicensing = change.needsSublicensing || undefined;
  if (change.requiresExclusive !== undefined) next.requiresExclusive = change.requiresExclusive || undefined;
  return next;
}

export interface AssetShift {
  assetId: string;
  fromOfferId?: string;
  toOfferId?: string;
  fromCents?: number;
  toCents?: number;
}

export interface WhatIfResult {
  currency: string;
  /** The cheapest compliant bundle for the brief as written, in the run's currency. */
  baselineCents?: number;
  /** The cheapest compliant bundle for the changed brief. Absent when some asset has no compliant offer. */
  totalCents?: number;
  /** totalCents - baselineCents, when both exist. Negative means cheaper. */
  deltaCents?: number;
  /** Assets whose cheapest compliant offer is different, or newly missing. */
  shifts: AssetShift[];
  /** Assets nothing covers under the changed brief. */
  uncoveredAssets: string[];
  /** For those assets, the closest offer and what to ask the licensor to change. */
  gaps: GapRequest[];
  /** How far the changed brief's cheapest bundle is over the budget, if there is one. */
  budgetShortfallCents: number;
}

/** The cheapest compliant offer per asset in one currency (what the optimizer chose). */
function cheapest(project: Project, required: string[], candidates: LicenseOffer[], currency: string, options: VerifyOptions) {
  const frontier = minimumCompliantCost(project, required, candidates, options);
  const plan = frontier.plans.find((p) => p.currency === currency);
  const byId = new Map(candidates.map((o) => [o.id, o]));
  const picked = new Map((plan?.offerIds ?? []).map((id) => [byId.get(id)!.assetId, byId.get(id)!]));
  return { plan, picked, frontier };
}

export function whatIf(project: Project, change: ProjectChange, requiredAssetIds: string[], candidates: LicenseOffer[], currency: string, options: VerifyOptions = {}): WhatIfResult {
  const required = [...new Set(requiredAssetIds)].sort();
  const changed = applyChange(project, change);
  const before = cheapest(project, required, candidates, currency, options);
  const after = cheapest(changed, required, candidates, currency, options);

  // Assets nothing covers (in any currency) are named by the optimizer itself.
  const uncoveredAssets = after.frontier.uncoveredAssets;
  const shifts: AssetShift[] = [];
  for (const assetId of required) {
    const a = before.picked.get(assetId);
    const b = after.picked.get(assetId);
    const gone = uncoveredAssets.includes(assetId);
    if (a?.id === b?.id || (!b && !gone)) continue;
    shifts.push({ assetId, fromOfferId: a?.id, toOfferId: b?.id, fromCents: a?.priceCents, toCents: b?.priceCents });
  }
  const complete = after.plan !== undefined;
  const totalCents = complete ? after.plan!.totalCents : undefined;
  const baselineCents = before.plan?.totalCents;
  return {
    currency,
    baselineCents,
    totalCents,
    deltaCents: totalCents !== undefined && baselineCents !== undefined ? totalCents - baselineCents : undefined,
    shifts,
    uncoveredAssets,
    gaps: uncoveredAssets.length ? gapRequests(changed, uncoveredAssets, candidates, options) : [],
    budgetShortfallCents: after.plan?.budgetShortfallCents ?? 0,
  };
}
