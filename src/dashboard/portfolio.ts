import type { SessionView } from "../app-logic/session";
import { licenceEnd } from "../core/renewals";
import { buildDashboardData } from "./data";

type Row = Record<string, string | number | null>;

const dollars = (cents: number) => cents / 100;
const text = (id: string, name: string) => ({ id, name, format: "textFormat" as const });
const money = (id: string, name: string) => ({ id, name, format: "currencyFormat" as const });
const decimal = (id: string, name: string) => ({ id, name, format: "decimalFormat" as const });
const whole = (id: string, name: string) => ({ id, name, format: "integerFormat" as const });

const runLabel = (v: SessionView) => v.project.name;
/** The currency a run settles in. Totals across runs are only added up for US dollars; nothing is converted. */
const runCurrency = (v: SessionView) => v.bundle?.currency ?? v.project.currency ?? "USD";

/**
 * Every run as linked tables for the portfolio dashboard: runs, offers, rule violations, creator
 * payouts and ledger events, joined on run id. Prices are dollars; unstated terms say "Not stated".
 */
/** Whether an agent's stated spending cap held, from the ledger entry written when the bundle was verified. */
function mandateLabel(v: SessionView): string {
  const status = v.events.find((e) => e.kind === "mandate_checked")?.payload.status;
  return status === "within" ? "Within cap" : status === "over" ? "Over cap" : status === "other_currency" ? "Not comparable" : "None stated";
}

export function buildPortfolioData(views: SessionView[]) {
  const runs: Row[] = [];
  const offers: Row[] = [];
  const violations: Row[] = [];
  const payouts: Row[] = [];
  const events: Row[] = [];
  const requirements: Row[] = [];
  const licences: Row[] = [];

  for (const v of views) {
    const t = buildDashboardData(v);
    const naive = v.analysis?.naiveTotalCents ?? 0;
    const chosen = v.bundle?.totalCents ?? 0;
    const currency = runCurrency(v);
    // Dollar columns hold dollar runs only, so a EUR run is never added into a USD total. Its own amount is in "…Local".
    const usd = (cents: number | null) => (cents === null ? null : currency === "USD" ? dollars(cents) : null);
    runs.push({
      runId: v.id,
      run: runLabel(v),
      started: v.createdAt,
      source: v.meta?.runKind === "live" ? "Live model" : "Replayed demo",
      status: v.phase,
      rounds: v.rounds ?? null,
      currency,
      verifiedTotal: usd(v.bundle ? chosen : null),
      priceOnlyTotal: usd(v.analysis ? naive : null),
      compliancePremium: usd(v.bundle && v.analysis ? Math.max(0, chosen - naive) : null),
      verifiedTotalLocal: v.bundle ? dollars(chosen) : null,
      blockedLicences: v.analysis?.blockedPurchases.length ?? 0,
      paid: v.capture ? "Paid" : "Not paid",
      startedBy: v.meta?.startedBy === "agent" ? "AI agent" : "Person",
      mandate: mandateLabel(v),
    });
    for (const o of t.offers) offers.push({ ...o, runId: v.id, run: runLabel(v) });
    for (const x of t.violations) violations.push({ ...x, runId: v.id, run: runLabel(v) });
    // Dollar columns again hold dollar runs only; a run in another currency keeps its own figures out of the sums.
    for (const r of t.requirements) requirements.push({ ...r, extraCost: currency === "USD" ? (r.extraCost ?? null) : null, costWithout: currency === "USD" ? (r.costWithout ?? null) : null, currency, runId: v.id, run: runLabel(v) });
    for (const e of t.events) events.push({ ...e, runId: v.id, run: runLabel(v) });
    // When each bought licence stops covering the project, counted from the day the payment was captured.
    const boughtOn = v.capture ? v.events.find((e) => e.kind === "captured")?.at.slice(0, 10) : undefined;
    if (boughtOn && v.bundle) {
      const licensorOf = new Map(v.documents.map((d) => [d.id, d.licensorName]));
      for (const o of v.bundle.offers) {
        const end = licenceEnd(o, boughtOn);
        licences.push({
          licenceId: `${v.id}:${o.id}`,
          label: `${licensorOf.get(o.evidence[0]?.documentId ?? "") ?? "Unnamed licensor"} · ${o.assetId}`,
          runId: v.id,
          run: runLabel(v),
          licensor: licensorOf.get(o.evidence[0]?.documentId ?? "") ?? "Unnamed licensor",
          asset: o.assetId,
          price: o.currency === "USD" ? dollars(o.priceCents) : null,
          currency: o.currency,
          boughtOn,
          endsOn: end.endsOn ?? "Perpetual",
          endsYear: end.endsOn ? Number(end.endsOn.slice(0, 4)) : null,
          cover: end.perpetual ? "Perpetual" : end.endsOn ? "Ends" : "End not stated",
        });
      }
    }
    for (const l of v.payouts?.lines ?? []) {
      payouts.push({ payoutId: `${v.id}:${l.offerId}`, runId: v.id, run: runLabel(v), licensor: l.licensorName, asset: l.assetId, amount: l.currency === "USD" ? dollars(l.amountCents) : null, currency: l.currency, amountLocal: dollars(l.amountCents), status: l.status });
    }
  }

  return {
    description:
      "LicenseGraph portfolio across projects. 'runs' has one row per licensing run (what the verified bundle cost, what a price-only purchase would have cost, how many licences the rules blocked, whether it was paid). 'offers' has every licence offer extracted from uploaded licences with its terms and whether it was chosen or rejected. 'violations' lists each rule the verifier found broken. 'requirements' shows what each requirement of each brief adds to the cheapest compliant bundle. 'payouts' lists the creators paid through PayPal Payouts. 'licences' says when each bought licence stops covering its project (or that it is perpetual). 'events' is the tamper-evident ledger. Dollar columns (Verified total, Price-only total, Compliance premium, Amount) include only runs settled in US dollars; a run in another currency shows its amount in the 'Local' column and its currency, and is never converted or added into a dollar total.",
    sources: [
      {
        id: "runs",
        name: "Runs",
        description: "One row per licensing run.",
        data: runs,
        fields: [text("runId", "Run id"), text("run", "Project"), text("started", "Started"), text("source", "Source"), text("status", "Status"), whole("rounds", "Agent rounds"), text("currency", "Currency"), money("verifiedTotal", "Verified total"), decimal("verifiedTotalLocal", "Verified total (own currency)"), money("priceOnlyTotal", "Price-only total"), money("compliancePremium", "Compliance premium"), whole("blockedLicences", "Licences blocked"), text("paid", "Payment"), text("startedBy", "Started by"), text("mandate", "Agent mandate")],
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
        fields: [text("payoutId", "Payout"), text("runId", "Run id"), text("run", "Project"), text("licensor", "Creator"), text("asset", "Asset"), money("amount", "Amount"), decimal("amountLocal", "Amount (own currency)"), text("currency", "Currency"), text("status", "Status")],
      },
      {
        id: "licences",
        name: "Licence end dates",
        description: "When each bought licence stops covering its project, counted from the day of purchase.",
        data: licences,
        fields: [text("licenceId", "Licence"), text("label", "Licence name"), text("runId", "Run id"), text("run", "Project"), text("licensor", "Licensor"), text("asset", "Asset"), money("price", "Price"), text("currency", "Currency"), text("boughtOn", "Bought on"), text("endsOn", "Covered until"), whole("endsYear", "Ends in year"), text("cover", "Cover")],
      },
      {
        id: "requirements",
        name: "Requirement costs",
        description: "What each requirement of each brief adds to that run's cheapest compliant bundle. Dollar runs only in the cost columns.",
        data: requirements,
        fields: [text("runId", "Run id"), text("run", "Project"), text("requirementId", "Rule"), text("requirement", "Requirement"), text("value", "Your brief says"), money("extraCost", "Adds to the cost"), money("costWithout", "Cost without it"), text("impact", "Impact"), text("currency", "Currency")],
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
      { id: "run-licences", source: { tableId: "runs", fieldId: "runId" }, target: { tableId: "licences", fieldId: "runId" }, type: "one-to-many" as const },
      { id: "run-requirements", source: { tableId: "runs", fieldId: "runId" }, target: { tableId: "requirements", fieldId: "runId" }, type: "one-to-many" as const },
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
        requirementCost: {
          type: "bar-chart-grouped",
          dataMapping: { categoryKey: [{ id: "requirements.requirement" }], valueKey: [{ id: "requirements.extraCost", aggregation: "sum" }] },
          format: { title: { enabled: true, text: "Cost of each requirement" } },
        },
        ruleMatrix: {
          type: "rule-matrix",
          dataMapping: { rows: [{ id: "violations.asset" }], columns: [{ id: "violations.rule" }], value: [{ id: "violations.violationId", aggregation: "count" }] },
          format: { title: { enabled: true, text: "Which rule keeps rejecting which asset" } },
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
        licenceTimeline: {
          type: "licence-timeline",
          dataMapping: { label: [{ id: "licences.label" }], start: [{ id: "licences.boughtOn" }], end: [{ id: "licences.endsOn" }] },
          format: { title: { enabled: true, text: "When each bought licence ends" } },
        },
        licencesGrid: {
          type: "grid",
          dataMapping: { cols: ["licences.run", "licences.licensor", "licences.asset", "licences.price", "licences.boughtOn", "licences.endsOn", "licences.cover"].map((id) => ({ id })) },
          format: { title: { enabled: true, text: "When each bought licence ends" } },
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
        priceVsVerified: { xTrack: 0, yTrack: 3, xSpan: 5, ySpan: 8 },
        byRule: { xTrack: 5, yTrack: 3, xSpan: 4, ySpan: 8 },
        requirementCost: { xTrack: 9, yTrack: 6, xSpan: 3, ySpan: 5 },
        runsGrid: { xTrack: 0, yTrack: 11, xSpan: 12, ySpan: 5 },
        payoutsGrid: { xTrack: 0, yTrack: 16, xSpan: 6, ySpan: 5 },
        ruleMatrix: { xTrack: 6, yTrack: 16, xSpan: 6, ySpan: 5 },
        offersGrid: { xTrack: 0, yTrack: 21, xSpan: 12, ySpan: 6 },
        licenceTimeline: { xTrack: 0, yTrack: 27, xSpan: 12, ySpan: 5 },
        licencesGrid: { xTrack: 0, yTrack: 32, xSpan: 12, ySpan: 5 },
      },
    },
  ],
};
