import { addMonths } from "./dates";
import { gapRequests } from "./insights";
import { minimumCompliantCost } from "./optimizer";
import { evaluateOffer, type VerifyOptions } from "./rules";
import type { Cents, LicenseOffer, LicenseTerms, Project, RuleId } from "./types";

/**
 * "If they said yes." When nothing can be bought, each gap lists the changes to ask a licensor for.
 * This answers the next question: if every licensor agreed to those changes at the price they already
 * quoted, what is the cheapest compliant bundle, and how much more could each asset cost before the
 * budget is broken? It is a best case, not an offer: a licensor may well ask for more, which is why
 * the per-asset ceiling is given. Nothing here is bought, and it is the rules engine that judges it.
 */

/** The marker on a hypothetical offer's id, so it can never be mistaken for one read from a licence. */
export const AGREED_SUFFIX = "#if-agreed";

/** Rules a licensor can change by agreeing. Price, currency and the quality of the written evidence are not theirs to concede here. */
const CONCEDABLE: RuleId[] = ["commercial-use", "territory", "term", "medium", "attribution", "sublicensing", "exclusivity", "expiry"];

/** The shortest term, in months, that reaches the project's length and its end date (if it has one). */
function termNeeded(project: Project, options: VerifyOptions): number {
  let months = project.termMonths;
  if (project.endDate && options.today) {
    while (months < 1200 && (addMonths(options.today, months) ?? "") < project.endDate) months++;
  }
  return months;
}

/** A copy of the offer whose terms meet the given rules, and are otherwise unchanged. The price stays as quoted. */
export function concede(project: Project, offer: LicenseOffer, rules: readonly RuleId[], options: VerifyOptions = {}): LicenseOffer {
  const terms: LicenseTerms = { ...offer.terms };
  for (const rule of rules) {
    switch (rule) {
      case "commercial-use":
        terms.commercialUse = true;
        break;
      case "territory":
        terms.territories = project.territories.includes("WORLD") || terms.territories.includes("WORLD") ? ["WORLD"] : [...new Set([...terms.territories, ...project.territories])];
        break;
      case "term":
        terms.termMonths = terms.termMonths === "perpetual" ? "perpetual" : Math.max(Number.isSafeInteger(terms.termMonths) ? terms.termMonths : 0, termNeeded(project, options));
        delete terms.fixedEndDate;
        break;
      case "medium":
        terms.mediums = terms.mediums === "ALL" ? "ALL" : [...new Set([...(terms.mediums ?? []), ...(project.mediums ?? [])])];
        break;
      case "attribution":
        terms.attributionRequired = false;
        break;
      case "sublicensing":
        terms.sublicensing = true;
        break;
      case "exclusivity":
        terms.exclusive = true;
        break;
      case "expiry":
        delete terms.offerValidUntil;
        break;
      default:
        break;
    }
  }
  return { ...offer, id: `${offer.id}${AGREED_SUFFIX}`, terms };
}

export interface AssetOutlook {
  assetId: string;
  /** The closest offer, whose terms were assumed changed. */
  offerId: string;
  /** What it would cost, as already quoted. */
  priceCents: Cents;
  /**
   * The most this asset's revised licence could cost, with every other asset at its best-case price, before
   * the budget is broken. Absent when the project has no budget.
   */
  ceilingCents?: Cents;
}

export interface NegotiationOutlook {
  currency: string;
  /** The cheapest compliant bundle if every licensor agreed to every ask at its quoted price. */
  totalCents: Cents;
  /** Every asset in the best-case bundle, and for the ones that needed asking, what they could cost. */
  assets: AssetOutlook[];
  /** The assets whose licence must change for this to work. */
  asked: string[];
  /** Budget minus the best-case total. Negative means even a yes to everything breaks the budget. */
  headroomCents?: Cents;
}

/**
 * The outlook for a run with no compliant bundle. It is absent when there is nothing to ask for, or
 * when asking cannot help (an asset with no offer at all, or a gap the licensor cannot close, such as
 * an offer priced in the wrong currency).
 */
export function negotiationOutlook(project: Project, requiredAssetIds: string[], candidates: LicenseOffer[], currency: string, options: VerifyOptions = {}): NegotiationOutlook | undefined {
  const required = [...new Set(requiredAssetIds)].sort();
  const gaps = gapRequests(project, required, candidates, options);
  if (!gaps.length) return undefined;

  // Each gap's closest offer, with the changes its licensor would have to make.
  const hypothetical: LicenseOffer[] = [];
  for (const gap of gaps) {
    const offer = candidates.find((o) => o.id === gap.offerId);
    if (!offer) return undefined;
    const failing = evaluateOffer(project, offer, options).filter((r) => r.status === "fail").map((r) => r.rule);
    const agreed = concede(project, offer, failing.filter((r) => CONCEDABLE.includes(r)), options);
    if (evaluateOffer(project, agreed, options).some((r) => r.status === "fail")) return undefined;
    hypothetical.push(agreed);
  }

  const { plans } = minimumCompliantCost(project, required, [...candidates, ...hypothetical], options);
  const plan = plans.find((p) => p.currency === currency);
  if (!plan) return undefined;
  const byId = new Map([...candidates, ...hypothetical].map((o) => [o.id, o]));
  const picked = plan.offerIds.map((id) => byId.get(id)!);

  const askedIds = new Set(gaps.map((g) => g.assetId));
  const assets: AssetOutlook[] = picked.map((o) => {
    const asked = askedIds.has(o.assetId);
    const ceilingCents = asked && project.budgetCents !== undefined ? project.budgetCents - (plan.totalCents - o.priceCents) : undefined;
    return { assetId: o.assetId, offerId: o.id.endsWith(AGREED_SUFFIX) ? o.id.slice(0, -AGREED_SUFFIX.length) : o.id, priceCents: o.priceCents, ceilingCents };
  });
  return {
    currency,
    totalCents: plan.totalCents,
    assets,
    asked: gaps.map((g) => g.assetId),
    headroomCents: project.budgetCents !== undefined ? project.budgetCents - plan.totalCents : undefined,
  };
}
