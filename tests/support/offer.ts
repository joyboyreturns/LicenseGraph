import type { LicenseOffer } from "../../src/core/types";

/** A compliant offer whose fields can be replaced for a specific test. */
export function offerWithEvidence(quote: string, overrides: Partial<LicenseOffer> = {}): LicenseOffer {
  return {
    id: "o1",
    assetId: "song",
    priceCents: 20_000,
    currency: "USD",
    terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24 },
    evidence: [{ documentId: "d1", quote }],
    ...overrides,
  };
}
