import { buildChart, buildTable, type Built, type FieldCatalog } from "./widget-tools";

export interface DashboardSuggestion {
  label: string;
  title: string;
  build: (catalog: FieldCatalog) => Built<Record<string, unknown>>;
}

/** Fixed, validated actions available without a model or account. */
export function dashboardSuggestions(portfolio: boolean): DashboardSuggestion[] {
  return portfolio ? [
    { label: "Who got paid?", title: "Creator payouts", build: (c) => buildTable(c, { title: "Creator payouts", columns: ["payouts.licensor", "payouts.amount"] }) },
    { label: "Compliance premium by run", title: "Compliance premium by run", build: (c) => buildChart(c, { kind: "bar", title: "Compliance premium by run", category: "runs.run", value: "runs.compliancePremium", aggregation: "sum" }) },
  ] : [
    { label: "What was rejected?", title: "Rule violations", build: (c) => buildTable(c, { title: "Rule violations", columns: ["violations.asset", "violations.rule", "violations.message"] }) },
    { label: "Compare offer prices", title: "Offer prices by asset", build: (c) => buildChart(c, { kind: "column", title: "Offer prices by asset", category: "offers.asset", value: "offers.price", aggregation: "sum", series: "offers.status" }) },
  ];
}
