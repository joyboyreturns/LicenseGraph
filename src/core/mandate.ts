/**
 * What an AI agent was told it may spend. The person gives the agent a cap; the agent states it when it starts a
 * purchase, and code checks the verified bundle against it. The check informs the person who approves; it never
 * approves anything, and a cap in another currency cannot be compared, so it is reported as not met.
 */
export interface Mandate {
  maxTotalCents: number;
  currency: string;
  note?: string;
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
