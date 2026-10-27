/** Money is always integer minor units (cents) in a single currency per bundle. */
export type Cents = number;

export type Territory = "WORLD" | (string & {}); // "WORLD" or an ISO 3166-1 alpha-2 code

/** Where a term came from, so every extracted claim links back to source text. */
export interface Evidence {
  documentId: string;
  /** Which term this supports: price, commercialUse, territories or term. */
  field?: string;
  quote: string;
  /** Character offsets into the source document, when known. */
  start?: number;
  end?: number;
}

export interface LicenseTerms {
  commercialUse: boolean;
  territories: Territory[];
  /** Months of validity from the licence start, or "perpetual". */
  termMonths: number | "perpetual";
}

export interface LicenseOffer {
  id: string;
  assetId: string;
  priceCents: Cents;
  currency: string;
  terms: LicenseTerms;
  evidence: Evidence[];
}

export interface Project {
  name: string;
  commercial: boolean;
  territories: Territory[];
  /** How long the project needs the assets for. */
  termMonths: number;
  budgetCents?: Cents;
}

export interface Bundle {
  offers: LicenseOffer[];
}

export type RuleId =
  | "coverage"
  | "duplicate-asset"
  | "commercial-use"
  | "territory"
  | "term"
  | "currency"
  | "evidence"
  | "budget";

export interface Violation {
  rule: RuleId;
  assetId?: string;
  offerId?: string;
  message: string;
}

export interface Verdict {
  ok: boolean;
  totalCents: Cents;
  violations: Violation[];
}
