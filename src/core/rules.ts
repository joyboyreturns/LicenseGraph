import type { Bundle, LicenseOffer, Project, Verdict, Violation } from "./types";

function coversTerritories(offered: string[], needed: string[]): boolean {
  if (offered.includes("WORLD")) return true;
  if (needed.includes("WORLD")) return false;
  return needed.every((t) => offered.includes(t));
}

function checkOffer(project: Project, offer: LicenseOffer): Violation[] {
  const out: Violation[] = [];
  const at = { assetId: offer.assetId, offerId: offer.id };

  if (project.commercial && !offer.terms.commercialUse) {
    out.push({ rule: "commercial-use", ...at, message: "Licence does not allow commercial use." });
  }
  if (!coversTerritories(offer.terms.territories, project.territories)) {
    out.push({ rule: "territory", ...at, message: "Licence territory does not cover the project's territories." });
  }
  if (offer.terms.termMonths !== "perpetual" && offer.terms.termMonths < project.termMonths) {
    out.push({
      rule: "term",
      ...at,
      message: `Licence lasts ${offer.terms.termMonths} months; project needs ${project.termMonths}.`,
    });
  }
  if (offer.evidence.length === 0 || offer.evidence.some((e) => e.quote.trim() === "")) {
    out.push({ rule: "evidence", ...at, message: "Offer terms are not linked to source text." });
  }
  return out;
}

/**
 * Deterministic verification of a proposed bundle. No model calls, no I/O:
 * the agent proposes, this decides. Payment is only reachable when `ok` is true.
 */
export function verifyBundle(project: Project, requiredAssetIds: string[], bundle: Bundle): Verdict {
  const violations: Violation[] = [];

  const seen = new Map<string, number>();
  for (const o of bundle.offers) seen.set(o.assetId, (seen.get(o.assetId) ?? 0) + 1);

  for (const id of requiredAssetIds) {
    if (!seen.has(id)) violations.push({ rule: "coverage", assetId: id, message: "No licence offer covers this asset." });
  }
  for (const [id, n] of seen) {
    if (n > 1) violations.push({ rule: "duplicate-asset", assetId: id, message: "More than one offer for this asset." });
  }

  for (const offer of bundle.offers) violations.push(...checkOffer(project, offer));

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
