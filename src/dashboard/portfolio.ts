import type { SessionView } from "../app-logic/session";
import { buildDashboardData } from "./data";

type Row = Record<string, string | number | null>;

const dollars = (cents: number) => cents / 100;
const text = (id: string, name: string) => ({ id, name, format: "textFormat" as const });
const money = (id: string, name: string) => ({ id, name, format: "currencyFormat" as const });
const whole = (id: string, name: string) => ({ id, name, format: "integerFormat" as const });

const runLabel = (v: SessionView) => v.project.name;

/**
 * Every run as linked tables for the portfolio dashboard: runs, offers, rule violations, creator
 * payouts and ledger events, joined on run id. Prices are dollars; unstated terms say "Not stated".
 */
export function buildPortfolioData(views: SessionView[]) {
  const runs: Row[] = [];
  const offers: Row[] = [];
  const violations: Row[] = [];
  const payouts: Row[] = [];
  const events: Row[] = [];

  for (const v of views) {
    const t = buildDashboardData(v);
    const naive = v.analysis?.naiveTotalCents ?? 0;
    const chosen = v.bundle?.totalCents ?? 0;
    runs.push({
      runId: v.id,
      run: runLabel(v),
      started: v.createdAt,
      source: v.meta?.runKind === "live" ? "Live model" : "Replayed demo",
      status: v.phase,
      rounds: v.rounds ?? null,
      verifiedTotal: v.bundle ? dollars(chosen) : null,
      priceOnlyTotal: v.analysis ? dollars(naive) : null,
      compliancePremium: v.bundle && v.analysis ? dollars(Math.max(0, chosen - naive)) : null,
      blockedLicences: v.analysis?.blockedPurchases.length ?? 0,
      paid: v.capture ? "Paid" : "Not paid",
    });
    for (const o of t.offers) offers.push({ ...o, runId: v.id, run: runLabel(v) });
    for (const x of t.violations) violations.push({ ...x, runId: v.id, run: runLabel(v) });
    for (const e of t.events) events.push({ ...e, runId: v.id, run: runLabel(v) });
    for (const l of v.payouts?.lines ?? []) {
      payouts.push({ payoutId: `${v.id}:${l.offerId}`, runId: v.id, run: runLabel(v), licensor: l.licensorName, asset: l.assetId, amount: dollars(l.amountCents), status: l.status });
    }
  }

  return {
    description:
      "LicenseGraph portfolio across projects. 'runs' has one row per licensing run (what the verified bundle cost, what a price-only purchase would have cost, how many licences the rules blocked, whether it was paid). 'offers' has every licence offer extracted from uploaded licences with its terms and whether it was chosen or rejected. 'violations' lists each rule the verifier found broken. 'payouts' lists the creators paid through PayPal Payouts. 'events' is the tamper-evident ledger. Prices are in US dollars.",
    sources: [
      {
        id: "runs",
        name: "Runs",
        description: "One row per licensing run.",
        data: runs,
        fields: [text("runId", "Run id"), text("run", "Project"), text("started", "Started"), text("source", "Source"), text("status", "Status"), whole("rounds", "Agent rounds"), money("verifiedTotal", "Verified total"), money("priceOnlyTotal", "Price-only total"), money("compliancePremium", "Compliance premium"), whole("blockedLicences", "Licences blocked"), text("paid", "Payment")],
      },
      {
        id: "offers",
        name: "Licence offers",
        description: "Every licence offer across runs, with terms and whether the verified bundle used it.",
        data: offers,
        fields: [
          text("runId", "Run id"), text("run", "Project"), text("offerId", "Offer"), text("document", "Licence document"), text("asset", "Asset"), money("price", "Price"), text("currency", "Currency"),
          text("use", "Use"), text("territories", "Territories"), whole("termMonths", "Term (months)"), text("term", "Term"), text("mediums", "Media"), text("attribution", "Attribution"),
          text("sublicensing", "Sublicensing"), text("exclusivity", "Exclusivity"), text("status", "Status"), whole("evidenceQuotes", "Evidence quotes"),
        ],
      },
      {
        id: "violations",
        name: "Rule violations",
        description: "Each rule the verifier found broken when it rejected a proposal.",
        data: violations,
        fields: [text("runId", "Run id"), text("run", "Project"), text("violationId", "Violation"), whole("round", "Round"), text("offerId", "Offer"), text("asset", "Asset"), text("rule", "Rule"), text("message", "Message")],
      },
      {
        id: "payouts",
        name: "Creator payouts",
        description: "Creators paid through PayPal Payouts after a purchase.",
        data: payouts,
        fields: [text("payoutId", "Payout"), text("runId", "Run id"), text("run", "Project"), text("licensor", "Creator"), text("asset", "Asset"), money("amount", "Amount"), text("status", "Status")],
      },
      {
        id: "events",
        name: "Ledger events",
        description: "The hash-chained ledger of everything that happened across runs.",
        data: events,
        fields: [text("runId", "Run id"), text("run", "Project"), whole("seq", "Sequence"), text("kind", "Event"), whole("round", "Round"), text("detail", "Detail"), text("at", "Time"), text("hash", "Hash")],
      },
    ],
    relationships: [
      { id: "run-offers", source: { tableId: "runs", fieldId: "runId" }, target: { tableId: "offers", fieldId: "runId" }, type: "one-to-many" as const },
      { id: "run-violations", source: { tableId: "runs", fieldId: "runId" }, target: { tableId: "violations", fieldId: "runId" }, type: "one-to-many" as const },
      { id: "run-payouts", source: { tableId: "runs", fieldId: "runId" }, target: { tableId: "payouts", fieldId: "runId" }, type: "one-to-many" as const },
      { id: "run-events", source: { tableId: "runs", fieldId: "runId" }, target: { tableId: "events", fieldId: "runId" }, type: "one-to-many" as const },
    ],
  };
}

/** The dashboard a portfolio opens with. Field ids are table.field, matching the data above. */
export const PORTFOLIO_INITIAL_STATE = {
  selectedPageId: "portfolio",
  pages: [
    {
      id: "portfolio",
      layout: { columns: 12, rowHeight: 56 },
      widgets: {
        verified: { type: "value", dataMapping: { value: [{ id: "runs.verifiedTotal", aggregation: "sum" }] }, format: { title: { enabled: true, text: "Verified licence spend" } } },
        blocked: { type: "value", dataMapping: { value: [{ id: "runs.blockedLicences", aggregation: "sum" }] }, format: { title: { enabled: true, text: "Licences blocked by the rules" } } },
        creators: { type: "value", dataMapping: { value: [{ id: "payouts.amount", aggregation: "sum" }] }, format: { title: { enabled: true, text: "Paid to creators" } } },
        priceVsVerified: {
          type: "column-chart-grouped",
          dataMapping: { categoryKey: [{ id: "runs.run" }], valueKey: [{ id: "runs.priceOnlyTotal", aggregation: "sum" }, { id: "runs.verifiedTotal", aggregation: "sum" }] },
          format: { title: { enabled: true, text: "Price-only vs verified total, by run" } },
        },
        byRule: {
          type: "bar-chart-grouped",
          dataMapping: { categoryKey: [{ id: "violations.rule" }], valueKey: [{ id: "violations.violationId", aggregation: "count" }] },
          format: { title: { enabled: true, text: "Rules that rejected proposals" } },
        },
        offerStatus: {
          type: "donut-chart",
          dataMapping: { categoryKey: [{ id: "offers.status" }], valueKey: [{ id: "offers.offerId", aggregation: "count" }] },
          format: { title: { enabled: true, text: "Offers by outcome" } },
        },
        payoutsGrid: {
          type: "grid",
          dataMapping: { cols: ["payouts.run", "payouts.licensor", "payouts.asset", "payouts.amount", "payouts.status"].map((id) => ({ id })) },
          format: { title: { enabled: true, text: "Creator payouts" } },
        },
        runsGrid: {
          type: "grid",
          dataMapping: { cols: ["runs.run", "runs.source", "runs.status", "runs.rounds", "runs.verifiedTotal", "runs.priceOnlyTotal", "runs.blockedLicences", "runs.paid"].map((id) => ({ id })) },
          format: { title: { enabled: true, text: "Runs" } },
        },
        offersGrid: {
          type: "grid",
          dataMapping: { cols: ["offers.run", "offers.asset", "offers.document", "offers.price", "offers.use", "offers.territories", "offers.term", "offers.mediums", "offers.attribution", "offers.sublicensing", "offers.status"].map((id) => ({ id })) },
          format: { title: { enabled: true, text: "Rights graph: every licence offer and its terms" } },
        },
      },
      widgetLayout: {
        verified: { xTrack: 0, yTrack: 0, xSpan: 3, ySpan: 3 },
        blocked: { xTrack: 3, yTrack: 0, xSpan: 3, ySpan: 3 },
        creators: { xTrack: 6, yTrack: 0, xSpan: 3, ySpan: 3 },
        offerStatus: { xTrack: 9, yTrack: 0, xSpan: 3, ySpan: 6 },
        priceVsVerified: { xTrack: 0, yTrack: 3, xSpan: 5, ySpan: 5 },
        byRule: { xTrack: 5, yTrack: 3, xSpan: 4, ySpan: 5 },
        runsGrid: { xTrack: 0, yTrack: 8, xSpan: 12, ySpan: 5 },
        payoutsGrid: { xTrack: 0, yTrack: 13, xSpan: 6, ySpan: 5 },
        offersGrid: { xTrack: 0, yTrack: 18, xSpan: 12, ySpan: 6 },
      },
    },
  ],
};
