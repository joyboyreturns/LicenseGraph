import type { Bundle, LicenseOffer, Project, RuleId, Verdict, Violation } from "./types";

export interface VerifyOptions {
  /** Today's date (YYYY-MM-DD). Needed only to check offer expiry; passed in so verification stays deterministic. */
  today?: string;
}

type At = { assetId: string; offerId: string };
type Rule = (project: Project, offer: LicenseOffer, at: At, options: VerifyOptions) => Violation[];

function coversTerritories(offered: string[], needed: string[]): boolean {
  if (offered.includes("WORLD")) return true;
  if (needed.includes("WORLD")) return false;
  return needed.every((t) => offered.includes(t));
}

const commercialUse: Rule = (project, offer, at) =>
  project.commercial && !offer.terms.commercialUse
    ? [{ rule: "commercial-use", ...at, message: "Licence does not allow commercial use." }]
    : [];

const territory: Rule = (project, offer, at) =>
  coversTerritories(offer.terms.territories, project.territories)
    ? []
    : [{ rule: "territory", ...at, message: "Licence territory does not cover the project's territories." }];

const term: Rule = (project, offer, at) => {
  const out: Violation[] = [];
  const { termMonths, fixedEndDate } = offer.terms;
  if (termMonths !== "perpetual" && termMonths < project.termMonths) {
    out.push({ rule: "term", ...at, message: `Licence lasts ${termMonths} months; project needs ${project.termMonths}.` });
  }
  if (fixedEndDate && project.endDate && fixedEndDate < project.endDate) {
    out.push({ rule: "term", ...at, message: `Licence ends ${fixedEndDate}; project needs it until ${project.endDate}.` });
  }
  return out;
};

const medium: Rule = (project, offer, at) => {
  if (!project.mediums?.length) return [];
  const offered = offer.terms.mediums;
  if (offered === undefined) return [{ rule: "medium", ...at, message: "Licence does not state which media it covers." }];
  if (offered === "ALL") return [];
  const missing = project.mediums.filter((m) => !offered.includes(m));
  return missing.length ? [{ rule: "medium", ...at, message: `Licence does not cover: ${missing.join(", ")}.` }] : [];
};

const attribution: Rule = (project, offer, at) => {
  if (project.canCredit !== false) return [];
  const needed = offer.terms.attributionRequired;
  if (needed === undefined) return [{ rule: "attribution", ...at, message: "Licence does not state whether attribution is required, and the project cannot credit." }];
  return needed ? [{ rule: "attribution", ...at, message: "Licence requires attribution; the project cannot credit." }] : [];
};

const sublicensing: Rule = (project, offer, at) => {
  if (!project.needsSublicensing) return [];
  return offer.terms.sublicensing === true
    ? []
    : [{ rule: "sublicensing", ...at, message: "Project needs sublicensing; the licence does not grant it." }];
};

const exclusivity: Rule = (project, offer, at) => {
  if (!project.requiresExclusive) return [];
  return offer.terms.exclusive === true
    ? []
    : [{ rule: "exclusivity", ...at, message: "Project needs an exclusive licence; this one is not exclusive." }];
};

const expiry: Rule = (_project, offer, at, options) => {
  const until = offer.terms.offerValidUntil;
  if (!until) return [];
  if (!options.today) return [{ rule: "expiry", ...at, message: "Offer has an expiry date but no current date was supplied to check it." }];
  return until < options.today ? [{ rule: "expiry", ...at, message: `Offer expired on ${until}.` }] : [];
};

const evidence: Rule = (_project, offer, at) =>
  offer.evidence.length === 0 || offer.evidence.some((e) => e.quote.trim() === "")
    ? [{ rule: "evidence", ...at, message: "Offer terms are not linked to source text." }]
    : [];

const OFFER_RULES: Rule[] = [commercialUse, territory, term, medium, attribution, sublicensing, exclusivity, expiry, evidence];

export type RuleStatus = "pass" | "fail" | "skip";

export interface RuleResult {
  rule: RuleId;
  label: string;
  status: RuleStatus;
  /** Why it failed; empty for pass and skip. */
  messages: string[];
}

/** Every rule the verifier knows, with whether the project's brief makes it relevant. */
export const RULE_CATALOG: { id: RuleId; label: string; applies: (p: Project, o: LicenseOffer) => boolean }[] = [
  { id: "commercial-use", label: "Commercial use", applies: (p) => p.commercial },
  { id: "territory", label: "Territory", applies: () => true },
  { id: "term", label: "Term", applies: () => true },
  { id: "medium", label: "Media", applies: (p) => Boolean(p.mediums?.length) },
  { id: "attribution", label: "Attribution", applies: (p) => p.canCredit === false },
  { id: "sublicensing", label: "Sublicensing", applies: (p) => Boolean(p.needsSublicensing) },
  { id: "exclusivity", label: "Exclusivity", applies: (p) => Boolean(p.requiresExclusive) },
  { id: "expiry", label: "Offer validity", applies: (_p, o) => Boolean(o.terms.offerValidUntil) },
  { id: "evidence", label: "Evidence", applies: () => true },
];

/**
 * Check one offer on its own against every rule, saying pass, fail or skip (the brief does not
 * declare that constraint). This is what the verification matrix shows: every candidate, not only
 * the bundle that was proposed.
 */
export function evaluateOffer(project: Project, offer: LicenseOffer, options: VerifyOptions = {}): RuleResult[] {
  const at = { assetId: offer.assetId, offerId: offer.id };
  const violations = OFFER_RULES.flatMap((rule) => rule(project, offer, at, options));
  return RULE_CATALOG.map(({ id, label, applies }) => {
    const messages = violations.filter((v) => v.rule === id).map((v) => v.message);
    const status: RuleStatus = messages.length ? "fail" : applies(project, offer) ? "pass" : "skip";
    return { rule: id, label, status, messages };
  });
}

/**
 * Deterministic verification of a proposed bundle. No model calls, no I/O:
 * the agent proposes, this decides. Payment is only reachable when `ok` is true.
 *
 * A constraint is checked only when the project declares it, and the offer must then
 * affirmatively meet it: an offer that is silent on something the project cares about fails.
 */
export function verifyBundle(project: Project, requiredAssetIds: string[], bundle: Bundle, options: VerifyOptions = {}): Verdict {
  const violations: Violation[] = [];

  const seen = new Map<string, number>();
  for (const o of bundle.offers) seen.set(o.assetId, (seen.get(o.assetId) ?? 0) + 1);

  for (const id of requiredAssetIds) {
    if (!seen.has(id)) violations.push({ rule: "coverage", assetId: id, message: "No licence offer covers this asset." });
  }
  for (const [id, n] of seen) {
    if (n > 1) violations.push({ rule: "duplicate-asset", assetId: id, message: "More than one offer for this asset." });
  }

  for (const offer of bundle.offers) {
    const at = { assetId: offer.assetId, offerId: offer.id };
    for (const rule of OFFER_RULES) violations.push(...rule(project, offer, at, options));
  }

  const currencies = new Set(bundle.offers.map((o) => o.currency));
  if (currencies.size > 1) {
    violations.push({ rule: "currency", message: "Bundle mixes currencies; one currency per bundle." });
  }

  const totalCents = bundle.offers.reduce((sum, o) => sum + o.priceCents, 0);
  if (project.budgetCents !== undefined && totalCents > project.budgetCents) {
    violations.push({ rule: "budget", message: `Bundle costs ${totalCents} cents; budget is ${project.budgetCents}.` });
  }

  return { ok: violations.length === 0, totalCents, violations };
}
