import { minimumCompliantCost } from "./optimizer";
import { evaluateOffer, RULE_CATALOG, type VerifyOptions } from "./rules";
import type { Cents, LicenseOffer, Project, RuleId } from "./types";

/**
 * Two questions the verdict alone cannot answer, both computed with the rules engine's own results and
 * no model: what each requirement costs the buyer, and, when nothing can be bought, what to ask for.
 */

/** Requirements a buyer can choose to drop. Currency, price and evidence are integrity rules, never relaxed. */
const RELAXABLE: RuleId[] = ["commercial-use", "territory", "term", "medium", "attribution", "sublicensing", "exclusivity"];

const failingRules = (project: Project, offer: LicenseOffer, options: VerifyOptions): RuleId[] =>
  evaluateOffer(project, offer, options).filter((r) => r.status === "fail").map((r) => r.rule);

const byPrice = (a: LicenseOffer, b: LicenseOffer) => a.priceCents - b.priceCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const usable = (o: LicenseOffer) => Number.isSafeInteger(o.priceCents) && o.priceCents > 0;

export interface RequirementCost {
  rule: RuleId;
  label: string;
  /** Minimum compliant total if only this requirement were dropped. */
  withoutCents: Cents;
  /** What keeping the requirement adds to the minimum compliant total (never negative). */
  extraCents: Cents;
  /** The offers that would be chosen without it. */
  offerIdsWithout: string[];
}

export interface RequirementCosts {
  currency: string;
  /** Minimum compliant total with every requirement kept: the independent cost check's figure. */
  baselineCents: Cents;
  /** Declared requirements only, most expensive first. */
  items: RequirementCost[];
}

/**
 * For each requirement the project declares, the exact minimum compliant cost if that one requirement
 * were dropped, so the buyer sees what each requirement costs. Exact because the rules judge every
 * offer on its own: dropping a rule only widens which offers each asset may pick from. Nothing is
 * converted between currencies, and the result is absent when no complete compliant bundle exists.
 */
export function requirementCosts(project: Project, requiredAssetIds: string[], candidates: LicenseOffer[], options: VerifyOptions = {}): RequirementCosts | undefined {
  const required = [...new Set(requiredAssetIds)].sort();
  const { plans } = minimumCompliantCost(project, required, candidates, options);
  const plan = plans.find((p) => p.currency === (project.currency ?? "USD")) ?? (plans.length === 1 ? plans[0] : undefined);
  if (!plan || !candidates.length) return undefined;

  const pool = candidates.filter((o) => required.includes(o.assetId) && o.currency === plan.currency && usable(o));
  const failures = new Map(pool.map((o) => [o.id, failingRules(project, o, options)]));

  const items: RequirementCost[] = [];
  for (const rule of RELAXABLE) {
    const entry = RULE_CATALOG.find((r) => r.id === rule)!;
    if (!pool.some((o) => entry.applies(project, o))) continue;
    const picks = required.map((asset) =>
      pool
        .filter((o) => o.assetId === asset && failures.get(o.id)!.every((f) => f === rule))
        .sort(byPrice)[0],
    );
    if (picks.some((p) => !p)) continue;
    const withoutCents = picks.reduce((n, p) => n + p!.priceCents, 0);
    items.push({ rule, label: entry.label, withoutCents, extraCents: Math.max(0, plan.totalCents - withoutCents), offerIdsWithout: picks.map((p) => p!.id) });
  }
  items.sort((a, b) => b.extraCents - a.extraCents || a.rule.localeCompare(b.rule));
  return { currency: plan.currency, baselineCents: plan.totalCents, items };
}

export interface GapAsk {
  rule: RuleId;
  /** One change to ask the licensor for, in plain words. */
  ask: string;
}

export interface GapRequest {
  assetId: string;
  /** The closest offer: the one that breaks the fewest rules, then the cheapest. */
  offerId: string;
  priceCents: Cents;
  currency: string;
  asks: GapAsk[];
}

const list = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const places = (t: readonly string[]) => (t.includes("WORLD") ? "worldwide" : t.join(", "));

function askFor(rule: RuleId, project: Project, offer: LicenseOffer, options: VerifyOptions): string | undefined {
  const t = offer.terms;
  switch (rule) {
    case "commercial-use":
      return "Allow commercial use (the offer is non-commercial).";
    case "territory":
      return `Cover ${places(project.territories)} (the offer covers ${places(t.territories) || "no stated territory"}).`;
    case "term": {
      const have = t.termMonths === "perpetual" ? "perpetual" : `${t.termMonths} months`;
      const until = project.endDate ? ` and until ${project.endDate}` : "";
      const fixed = t.fixedEndDate ? ` (it ends on ${t.fixedEndDate})` : "";
      return `Run for at least ${project.termMonths} months${until} (the offer is ${have}${fixed}).`;
    }
    case "medium": {
      if (t.mediums === undefined) return `State which media the licence covers; we need ${list(project.mediums ?? [])}.`;
      const missing = (project.mediums ?? []).filter((m) => t.mediums !== "ALL" && !t.mediums!.includes(m));
      return missing.length ? `Add ${list(missing)} to the covered media.` : undefined;
    }
    case "attribution":
      return t.attributionRequired === undefined ? "State whether credit is required; we cannot credit creators." : "Waive the credit requirement; we cannot credit creators.";
    case "sublicensing":
      return "Grant the right to sublicense.";
    case "exclusivity":
      return "Make the licence exclusive.";
    case "expiry":
      return `Re-issue the offer; it expired on ${t.offerValidUntil ?? "an earlier date"}${options.today ? ` and we are checking on ${options.today}` : ""}.`;
    case "currency":
      return `Quote in ${project.currency ?? "USD"}; we do not convert currencies.`;
    case "amount":
      return "Confirm a clear price.";
    case "evidence":
      return "Provide the licence terms in writing so each can be quoted.";
    default:
      return undefined;
  }
}

/**
 * Where no offer for an asset passes the rules, the one that comes closest and exactly what to change
 * in it. Assets that already have a compliant offer are left out; a budget shortfall is a different
 * problem and is reported by the independent cost check.
 */
export function gapRequests(project: Project, requiredAssetIds: string[], candidates: LicenseOffer[], options: VerifyOptions = {}): GapRequest[] {
  const out: GapRequest[] = [];
  for (const assetId of [...new Set(requiredAssetIds)]) {
    const offers = candidates.filter((o) => o.assetId === assetId);
    const scored = offers.map((offer) => ({ offer, failing: failingRules(project, offer, options) }));
    if (!scored.length || scored.some((s) => s.failing.length === 0)) continue;
    scored.sort((a, b) => a.failing.length - b.failing.length || byPrice(a.offer, b.offer));
    const { offer, failing } = scored[0]!;
    const asks = failing.flatMap((rule) => {
      const ask = askFor(rule, project, offer, options);
      return ask ? [{ rule, ask }] : [];
    });
    out.push({ assetId, offerId: offer.id, priceCents: offer.priceCents, currency: offer.currency, asks });
  }
  return out;
}

/** A ready-to-send message to the licensor. Plain text, built only from the run's own facts. */
export function draftLicensorMessage(project: Project, gap: GapRequest, licensorName?: string): { subject: string; body: string } {
  const price = `${(gap.priceCents / 100).toFixed(2)} ${gap.currency}`;
  const subject = `Licence terms for the ${gap.assetId} in "${project.name}"`;
  const body = [
    `Hello${licensorName ? ` ${licensorName}` : ""},`,
    "",
    `We would like to license your ${gap.assetId} for "${project.name}". Your offer at ${price} is close to what we need, but as written it does not yet work for us:`,
    "",
    ...gap.asks.map((a) => `- ${a.ask}`),
    "",
    "Could you tell us whether you can adjust the licence on these points, and what the price would be? Any revised terms will be checked against our requirements before we buy.",
    "",
    "Thank you.",
  ].join("\n");
  return { subject, body };
}
