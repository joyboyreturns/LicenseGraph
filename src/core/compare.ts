import type { LicenseOffer } from "./types";

export interface RunOutcome {
  offers: LicenseOffer[];
  totalCents: number;
  currency: string;
}

export type AssetChange = "same" | "cheaper" | "dearer" | "other-licence" | "gained" | "lost";

export interface AssetComparison {
  assetId: string;
  change: AssetChange;
  before?: { offerId: string; priceCents: number };
  after?: { offerId: string; priceCents: number };
}

export interface RunComparison {
  assets: AssetComparison[];
  /** Null when either run bought nothing, or the two were priced in different currencies. */
  deltaCents: number | null;
  currency: string | null;
}

/**
 * Two runs of the same project, side by side: which asset's licence changed, and what it did to the total. Takes
 * only the verified outcomes; a run with no compliant bundle has nothing to compare, so each asset reads as
 * gained or lost.
 */
export function compareRuns(before: RunOutcome | undefined, after: RunOutcome | undefined): RunComparison {
  const pick = (o?: RunOutcome) => new Map((o?.offers ?? []).map((x) => [x.assetId, { offerId: x.id, priceCents: x.priceCents }]));
  const b = pick(before);
  const a = pick(after);
  const assets = [...new Set([...b.keys(), ...a.keys()])].sort().map((assetId): AssetComparison => {
    const was = b.get(assetId);
    const now = a.get(assetId);
    const change: AssetChange = !was ? "gained" : !now ? "lost" : was.offerId === now.offerId ? "same" : was.priceCents === now.priceCents ? "other-licence" : now.priceCents < was.priceCents ? "cheaper" : "dearer";
    return { assetId, change, ...(was ? { before: was } : {}), ...(now ? { after: now } : {}) };
  });
  const comparable = before && after && before.currency === after.currency;
  return { assets, deltaCents: comparable ? after.totalCents - before.totalCents : null, currency: comparable ? after.currency : null };
}
