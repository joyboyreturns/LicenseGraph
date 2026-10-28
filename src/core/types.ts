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
  /** Media the licence covers (e.g. "web", "print", "broadcast"), or "ALL". Absent means not stated. */
  mediums?: string[] | "ALL";
  /** True if the licensee must credit the creator. Absent means not stated. */
  attributionRequired?: boolean;
  /** True if the licensee may sublicense. Absent means not stated. */
  sublicensing?: boolean;
  /** True if the licence is exclusive to the licensee. Absent means not stated. */
  exclusive?: boolean;
  /** Licence ends on this fixed date (YYYY-MM-DD), regardless of `termMonths`. */
  fixedEndDate?: string;
  /** Last date (YYYY-MM-DD) this offer can be bought. */
  offerValidUntil?: string;
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
  /** Budget/settlement currency. A budget without this field is USD, as in the brief editor. */
  currency?: string;
  /** Constraints below are checked only when declared; the offer must then state that it meets them. */
  mediums?: string[];
  /** False when the project cannot credit creators. */
  canCredit?: boolean;
  needsSublicensing?: boolean;
  requiresExclusive?: boolean;
  /** Last day (YYYY-MM-DD) the project needs the assets. */
  endDate?: string;
}

export interface Bundle {
  offers: LicenseOffer[];
}

export type RuleId =
  | "amount"
  | "requirements"
  | "coverage"
  | "duplicate-asset"
  | "commercial-use"
  | "territory"
  | "term"
  | "medium"
  | "attribution"
  | "sublicensing"
  | "exclusivity"
  | "expiry"
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
