import type { SessionView } from "../app-logic/session";
import type { LicenseOffer, LicenseTerms, Violation } from "../core/types";

type Row = Record<string, string | number | null>;

export interface DashboardTables {
  assets: Row[];
  offers: Row[];
  violations: Row[];
  events: Row[];
}

const dollars = (cents: number) => cents / 100;
const yesNo = (v: boolean | undefined, yes: string, no: string) => (v === undefined ? "Not stated" : v ? yes : no);

function mediumsText(m: LicenseTerms["mediums"]): string {
  return m === undefined ? "Not stated" : m === "ALL" ? "Any medium" : m.join(", ");
}

function detail(kind: string, p: Record<string, unknown>): string {
  const ids = (p.offerIds as string[] | undefined)?.join(", ") ?? "";
  switch (kind) {
    case "extracted":
      return `${p.documentId} for ${p.assetId}`;
    case "extraction_failed":
      return `${p.documentId}: terms could not be verified`;
    case "proposed":
    case "revised":
      return ids;
    case "rejected":
      return `${(p.violations as unknown[]).length} violation(s) in ${ids}`;
    case "verified":
      return `${ids} (${dollars(Number(p.totalCents)).toFixed(2)})`;
    case "approved":
      return `Approved by ${p.approvedBy}`;
    case "order_created":
      return `PayPal order ${p.orderId}`;
    case "captured":
      return `Capture ${p.captureId}`;
    default:
      return String(p.error ?? "");
  }
}

/**
 * Flatten a session into the tables the dashboard queries. Prices are in dollars (not cents) so the
 * currency format reads naturally; unstated terms say "Not stated" so a missing term is visible.
 */
export function buildDashboardData(view: SessionView): DashboardTables {
  const chosen = new Set(view.bundle?.offers.map((o) => o.id));
  const violations: Row[] = [];
  view.events
    .filter((e) => e.kind === "rejected")
    .forEach((e) => {
      (e.payload.violations as Violation[]).forEach((v, i) => {
        violations.push({
          violationId: `r${e.payload.round}-${i + 1}`,
          round: Number(e.payload.round),
          offerId: v.offerId ?? null,
          asset: v.assetId ?? "Whole bundle",
          rule: v.rule,
          message: v.message,
        });
      });
    });
  const rejected = new Set(violations.map((v) => v.offerId).filter((id): id is string => typeof id === "string"));

  const offers: Row[] = view.candidates.map((o: LicenseOffer) => ({
    offerId: o.id,
    document: o.id.replace(/^offer-/, ""),
    asset: o.assetId,
    price: dollars(o.priceCents),
    currency: o.currency,
    use: o.terms.commercialUse ? "Commercial" : "Non-commercial",
    territories: o.terms.territories.join(", "),
    termMonths: o.terms.termMonths === "perpetual" ? null : o.terms.termMonths,
    term: o.terms.termMonths === "perpetual" ? "Perpetual" : `${o.terms.termMonths} months`,
    mediums: mediumsText(o.terms.mediums),
    attribution: yesNo(o.terms.attributionRequired, "Credit required", "No credit needed"),
    sublicensing: yesNo(o.terms.sublicensing, "Allowed", "Not allowed"),
    exclusivity: yesNo(o.terms.exclusive, "Exclusive", "Non-exclusive"),
    status: chosen.has(o.id) ? "In verified bundle" : rejected.has(o.id) ? "Rejected by rules" : "Not chosen",
    evidenceQuotes: o.evidence.length,
  }));

  const assetIds = [...new Set(view.candidates.map((c) => c.assetId))];
  const assets: Row[] = assetIds.map((asset) => {
    const options = view.candidates.filter((c) => c.assetId === asset);
    const pick = options.find((o) => chosen.has(o.id));
    return {
      asset,
      chosenOffer: pick?.id ?? "None",
      chosenPrice: pick ? dollars(pick.priceCents) : null,
      candidates: options.length,
      cheapestPrice: dollars(Math.min(...options.map((o) => o.priceCents))),
    };
  });

  const events: Row[] = view.events.map((e) => ({
    seq: e.seq,
    kind: e.kind,
    round: typeof e.payload.round === "number" ? e.payload.round : null,
    detail: detail(e.kind, e.payload),
    at: e.at,
    hash: e.hash.slice(0, 12),
  }));

  return { assets, offers, violations, events };
}

const text = (id: string, name: string) => ({ id, name, format: "textFormat" as const });
const money = (id: string, name: string) => ({ id, name, format: "currencyFormat" as const });
const whole = (id: string, name: string) => ({ id, name, format: "integerFormat" as const });

/** The AG Studio data definition: four tables linked into a small rights graph. */
export function buildStudioData(view: SessionView) {
  const t = buildDashboardData(view);
  return {
    description:
      "LicenseGraph run for one project. 'assets' are the creative assets the project needs, 'offers' are the licence offers extracted from uploaded licences (each linked to quotes in the source text), 'violations' are the rules the verifier found broken when it rejected a proposed bundle, and 'events' is the tamper-evident ledger of every step. Prices are in US dollars.",
    sources: [
      {
        id: "assets",
        name: "Assets",
        description: "One row per required creative asset: which offer was chosen for it and what it costs.",
        data: t.assets,
        fields: [text("asset", "Asset"), text("chosenOffer", "Chosen offer"), money("chosenPrice", "Chosen price"), whole("candidates", "Candidate offers"), money("cheapestPrice", "Cheapest offer")],
      },
      {
        id: "offers",
        name: "Licence offers",
        description: "One row per licence offer extracted from a licence document, with its terms and whether the verified bundle used it.",
        data: t.offers,
        fields: [
          text("offerId", "Offer"), text("document", "Licence document"), text("asset", "Asset"), money("price", "Price"), text("currency", "Currency"),
          text("use", "Use"), text("territories", "Territories"), whole("termMonths", "Term (months)"), text("term", "Term"), text("mediums", "Media"),
          text("attribution", "Attribution"), text("sublicensing", "Sublicensing"), text("exclusivity", "Exclusivity"), text("status", "Status"), whole("evidenceQuotes", "Evidence quotes"),
        ],
      },
      {
        id: "violations",
        name: "Rule violations",
        description: "Each rule the verifier found broken when it rejected a proposed bundle.",
        data: t.violations,
        fields: [text("violationId", "Violation"), whole("round", "Round"), text("offerId", "Offer"), text("asset", "Asset"), text("rule", "Rule"), text("message", "Message")],
      },
      {
        id: "events",
        name: "Ledger events",
        description: "The hash-chained ledger of everything that happened in the run, in order.",
        data: t.events,
        fields: [whole("seq", "Sequence"), text("kind", "Event"), whole("round", "Round"), text("detail", "Detail"), text("at", "Time"), text("hash", "Hash")],
      },
    ],
    relationships: [
      { id: "asset-offers", source: { tableId: "assets", fieldId: "asset" }, target: { tableId: "offers", fieldId: "asset" }, type: "one-to-many" as const },
      { id: "offer-violations", source: { tableId: "offers", fieldId: "offerId" }, target: { tableId: "violations", fieldId: "offerId" }, type: "one-to-many" as const },
    ],
  };
}
