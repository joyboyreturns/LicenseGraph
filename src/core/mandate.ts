/**
 * What an AI agent was told it may spend. The person gives the agent a cap; the agent states it when it starts a
 * purchase, and code checks the verified bundle against it. The check informs the person who approves; it never
 * approves anything, and a cap in another currency cannot be compared, so it is reported as not met.
 */
export interface Mandate {
  maxTotalCents: number;
  currency: string;
  note?: string;
  /** No single licence may cost more than this, in the mandate's currency. */
  maxPerLicenceCents?: number;
  /** Licensors the person does not want to buy from (matched by name, ignoring case and spacing). */
  avoidLicensors?: string[];
}

export type MandateCheck =
  | { status: "within"; marginCents: number }
  | { status: "over"; overByCents: number }
  | { status: "other_currency" };

export function checkMandate(mandate: Mandate, bundle: { totalCents: number; currency: string }): MandateCheck {
  if (bundle.currency !== mandate.currency) return { status: "other_currency" };
  return bundle.totalCents <= mandate.maxTotalCents
    ? { status: "within", marginCents: mandate.maxTotalCents - bundle.totalCents }
    : { status: "over", overByCents: bundle.totalCents - mandate.maxTotalCents };
}

export interface MandateBreach {
  kind: "per-licence-cap" | "avoided-licensor";
  assetId: string;
  /** In words, for the person who approves. */
  detail: string;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const money = (cents: number, currency: string) => (cents / 100).toLocaleString("en-US", { style: "currency", currency });

/**
 * The licence-level limits of a mandate, checked against the licences in the verified bundle: a price above the
 * per-licence cap, or a licensor the person asked not to buy from. Like the total cap, this informs the person who
 * approves; it never approves or blocks anything.
 */
export function mandateBreaches(mandate: Mandate, licences: { assetId: string; priceCents: number; currency: string; licensor?: string }[]): MandateBreach[] {
  const avoided = new Set((mandate.avoidLicensors ?? []).map(squash).filter(Boolean));
  const out: MandateBreach[] = [];
  for (const l of licences) {
    if (mandate.maxPerLicenceCents !== undefined && l.currency === mandate.currency && l.priceCents > mandate.maxPerLicenceCents) {
      out.push({ kind: "per-licence-cap", assetId: l.assetId, detail: `The ${l.assetId} licence costs ${money(l.priceCents, l.currency)}, above the ${money(mandate.maxPerLicenceCents, mandate.currency)} the agent was allowed for one licence.` });
    }
    if (l.licensor && avoided.has(squash(l.licensor))) {
      out.push({ kind: "avoided-licensor", assetId: l.assetId, detail: `The ${l.assetId} licence is from ${l.licensor}, a licensor the agent was told not to buy from.` });
    }
  }
  return out;
}
