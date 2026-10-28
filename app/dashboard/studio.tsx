"use client";

import { AgStudioAiModule, createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgReportState } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { widgets, type StudioRegistry } from "./rule-matrix";
import { useEffect, useMemo, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { buildStudioData } from "@/src/dashboard/data";
import { buildPortfolioData, PORTFOLIO_INITIAL_STATE } from "@/src/dashboard/portfolio";
import { chatCompletionsAdapter } from "@/src/dashboard/llm-adapter";
import { licenseGraphTheme } from "@/src/dashboard/theme";
import { describeSchema } from "@/src/dashboard/schema-text";
import { AGGREGATIONS, buildChart, buildKpi, buildLicenceTimeline, buildTable, catalogFrom, CHART_TYPES, placeWidget, type Aggregation, type Built, type ChartKind } from "@/src/dashboard/widget-tools";

const initialState: AgReportState<StudioRegistry> = {
  selectedPageId: "overview",
  pages: [
    {
      id: "overview",
      layout: { columns: 12, rowHeight: 56 },
      widgets: {
        spend: {
          type: "value",
          dataMapping: { value: [{ id: "assets.chosenPrice", aggregation: "sum" }] },
          format: { title: { enabled: true, text: "Verified bundle total" } },
        },
        offerPrices: {
          type: "column-chart-grouped",
          dataMapping: { categoryKey: [{ id: "offers.asset" }], valueKey: [{ id: "offers.price", aggregation: "sum" }], legendKey: [{ id: "offers.status" }] },
          format: { title: { enabled: true, text: "Offer prices by asset" } },
        },
        violationsByRule: {
          type: "bar-chart-grouped",
          dataMapping: { categoryKey: [{ id: "violations.rule" }], valueKey: [{ id: "violations.violationId", aggregation: "count" }] },
          format: { title: { enabled: true, text: "Rules that rejected a proposal" } },
        },
        requirementCost: {
          type: "bar-chart-grouped",
          dataMapping: { categoryKey: [{ id: "requirements.requirement" }], valueKey: [{ id: "requirements.extraCost", aggregation: "sum" }] },
          format: { title: { enabled: true, text: "Cost of each requirement" } },
        },
        ruleMatrix: {
          type: "rule-matrix",
          dataMapping: { rows: [{ id: "violations.asset" }], columns: [{ id: "violations.rule" }], value: [{ id: "violations.violationId", aggregation: "count" }] },
          format: { title: { enabled: true, text: "Which rule rejected which asset" } },
        },
        gapRequests: {
          type: "grid",
          dataMapping: { cols: ["gaps.asset", "gaps.offerId", "gaps.rule", "gaps.ask"].map((id) => ({ id })) },
          format: { title: { enabled: true, text: "Gap requests: what to ask each licensor" } },
        },
        rights: {
          type: "grid",
          dataMapping: {
            cols: ["offers.asset", "offers.document", "offers.price", "offers.use", "offers.territories", "offers.term", "offers.mediums", "offers.attribution", "offers.sublicensing", "offers.exclusivity", "offers.status"].map((id) => ({ id })),
          },
          format: { title: { enabled: true, text: "Rights graph: every licence offer and its terms" } },
        },
        ledger: {
          type: "grid",
          dataMapping: { cols: ["events.seq", "events.kind", "events.round", "events.detail", "events.hash"].map((id) => ({ id })) },
          format: { title: { enabled: true, text: "Ledger" } },
        },
      },
      widgetLayout: {
        spend: { xTrack: 0, yTrack: 0, xSpan: 3, ySpan: 3 },
        offerPrices: { xTrack: 3, yTrack: 0, xSpan: 5, ySpan: 5 },
        violationsByRule: { xTrack: 8, yTrack: 0, xSpan: 4, ySpan: 5 },
        requirementCost: { xTrack: 0, yTrack: 5, xSpan: 6, ySpan: 5 },
        gapRequests: { xTrack: 6, yTrack: 5, xSpan: 6, ySpan: 5 },
        ruleMatrix: { xTrack: 0, yTrack: 10, xSpan: 12, ySpan: 4 },
        rights: { xTrack: 0, yTrack: 14, xSpan: 12, ySpan: 6 },
        ledger: { xTrack: 0, yTrack: 20, xSpan: 12, ySpan: 6 },
      },
    },
  ],
};

const INSTRUCTIONS = [
  "You build dashboard views for a licence-rights tool called LicenseGraph.",
  "The data describes one run: assets, licence offers (with their terms), rule violations, what each requirement adds to the cost, gap requests for licensors, and a ledger of events. All prices are in the run's own currency.",
  "The data schema is below. Fields are written table.field, for example offers.price.",
  "To build something, call create_chart, create_table or create_kpi straight away. Prefer a chart for comparisons and a table only when asked for one.",
  "Only say you added something if the tool reported success. If a tool returns an error, fix the arguments and call it again.",
  "Keep replies to one or two sentences.",
].join("\n");

const PROMPT_STARTERS = [
  { label: "Chosen vs cheapest price", prompt: "Add a chart comparing the chosen price with the cheapest offer for each asset." },
  { label: "Offers by status", prompt: "Show how many licence offers are in the verified bundle versus rejected by the rules." },
  { label: "What was rejected?", prompt: "Add a table of every rule violation with the offer and message." },
];

const PORTFOLIO_INSTRUCTIONS = [
  "You build dashboard views for a licence-rights tool called LicenseGraph.",
  "The data covers every licensing run: runs (what each verified bundle cost versus a price-only purchase), licence offers with their terms, rule violations, creator payouts and ledger events. All prices are US dollars.",
  "The data schema is below. Fields are written table.field, for example runs.verifiedTotal.",
  "To build something, call create_chart, create_table or create_kpi straight away. Prefer a chart for comparisons and a table only when asked for one. For when licences end, call create_licence_timeline.",
  "Only say you added something if the tool reported success. If a tool returns an error, fix the arguments and call it again.",
  "Keep replies to one or two sentences.",
].join("\n");

const PORTFOLIO_PROMPT_STARTERS = [
  { label: "Premium by run", prompt: "Add a chart of the compliance premium for each run." },
  { label: "Who got paid?", prompt: "Show a chart of the amount paid to each creator." },
  { label: "Terms we keep missing", prompt: "Add a chart counting offers by their attribution status." },
  { label: "When do licences end?", prompt: "Add a timeline of when each bought licence ends." },
];


/** Follows the site's light/dark choice: the toggle sets data-theme on <html>, otherwise the system preference applies. */
function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const explicit = document.documentElement.dataset.theme;
      setDark(explicit === "dark" || (explicit !== "light" && media.matches));
    };
    read();
    media.addEventListener("change", read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);
  return dark;
}

type StudioProps = { assistant: boolean } & ({ view: SessionView; portfolio?: undefined } | { portfolio: SessionView[]; view?: undefined });

export default function Studio(props: StudioProps) {
  const { assistant } = props;
  const isPortfolio = props.portfolio !== undefined;
  const [mode, setMode] = useState<"view" | "edit">("view");
  const dark = useDarkMode();
  const theme = useMemo(() => licenseGraphTheme(dark), [dark]);
  const data = useMemo(() => {
    const def = props.portfolio ? buildPortfolioData(props.portfolio) : buildStudioData(props.view);
    // Money fields are in major units of the run's own currency (dollars for the portfolio); show them with its symbol.
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: (def as { currency?: string }).currency ?? "USD" });
    for (const source of def.sources) for (const f of source.fields) if (f.format === "currencyFormat") Object.assign(f, { formatOptions: { format: money } });
    return def;
  }, [props.portfolio, props.view]);
  // The assistant talks to our server route, which holds the gateway key and fixes the (free) model.
  const ai = useMemo<AgAiHarnessSetup | undefined>(() => {
    if (!assistant) return undefined;
    const adapter = chatCompletionsAdapter({ endpoint: "/api/llm" });
    const catalog = catalogFrom(data);
    const fields = catalog.ids;
    return ({ api }) => {
      // Each tool validates its arguments, then adds the widget to the selected page.
      // Studio's shape builder is generic over the tool's arguments, so the callbacks are loosely typed here.
      const add = (title: string, built: Built<Record<string, unknown>>, label: string, ctx: { success: (m: string) => unknown; error: (m: string[]) => unknown }) => {
        if (!built.ok) return ctx.error(built.errors) as never;
        const { state, widgetId } = placeWidget(api.getState() as never, title, built.widget, built.size);
        api.setState(state as never);
        return ctx.success(`Added ${label} "${title}" (${widgetId}) to the dashboard.`) as never;
      };

      const createChart = api.defineAiTool({
        name: "create_chart",
        description: "Add a chart to the dashboard. The category field is grouped along the axis; the value field is a number that gets aggregated; series is an optional text field that splits the bars or lines (use \"none\" for no split).",
        params: (s: any) => s.object({ kind: s.enum(Object.keys(CHART_TYPES)), title: s.string(), category: s.enum(fields), value: s.enum(fields), aggregation: s.enum(AGGREGATIONS), series: s.enum(["none", ...catalog.text]) }),
        execute: (a: { kind: string; title: string; category: string; value: string; aggregation: string; series: string }, ctx: any) =>
          add(a.title, buildChart(catalog, { kind: a.kind as ChartKind, title: a.title, category: a.category, value: a.value, aggregation: a.aggregation as Aggregation, series: a.series === "none" ? undefined : a.series }), `${a.kind} chart`, ctx),
      } as never);

      const createTable = api.defineAiTool({
        name: "create_table",
        description: "Add a table showing the chosen fields as columns.",
        params: (s: any) => s.object({ title: s.string(), columns: s.array(s.enum(fields)) }),
        execute: (a: { title: string; columns: string[] }, ctx: any) => add(a.title, buildTable(catalog, a), "table", ctx),
      } as never);

      const createKpi = api.defineAiTool({
        name: "create_kpi",
        description: "Add a single headline number: one field, aggregated.",
        params: (s: any) => s.object({ title: s.string(), value: s.enum(fields), aggregation: s.enum(AGGREGATIONS) }),
        execute: (a: { title: string; value: string; aggregation: string }, ctx: any) => add(a.title, buildKpi(catalog, { title: a.title, value: a.value, aggregation: a.aggregation as Aggregation }), "KPI", ctx),
      } as never);

      // Only a portfolio has bought licences to draw.
      const createTimeline = api.defineAiTool({
        name: "create_licence_timeline",
        description: "Add a timeline showing when each bought licence ends, with a line for today and the licences ending soon highlighted.",
        params: (s: any) => s.object({ title: s.string() }),
        execute: (a: { title: string }, ctx: any) => add(a.title, buildLicenceTimeline(catalog, { title: a.title }), "licence timeline", ctx),
      } as never);

      return createAiHarness(api, () => ({
        agents: [
          directLlmRunner({
            id: "analyst",
            adapter,
            instructions: () => `${isPortfolio ? PORTFOLIO_INSTRUCTIONS : INSTRUCTIONS}\n\n${describeSchema(api.getAiContext().schema() as never)}`,
            tools: () => (isPortfolio ? [createChart, createTable, createKpi, createTimeline] : [createChart, createTable, createKpi]),
          }),
        ],
        primary: "analyst",
        models: [{ id: "server", label: "Free model (server-side)" }],
        promptStarters: isPortfolio ? PORTFOLIO_PROMPT_STARTERS : PROMPT_STARTERS,
      }));
    };
  }, [assistant, data, isPortfolio]);

  return (
    <AgStudioProvider modules={assistant ? [AgStudioAiModule] : []} licenseKey={process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY}>
      <div style={{ display: "flex", gap: 8, padding: "8px 16px" }}>
        <button type="button" className={mode === "view" ? "primary" : ""} onClick={() => setMode("view")}>View</button>
        <button type="button" className={mode === "edit" ? "primary" : ""} onClick={() => setMode("edit")}>Edit dashboard</button>
      </div>
      <AgStudio<StudioRegistry> data={data as never} widgets={widgets} initialState={(isPortfolio ? PORTFOLIO_INITIAL_STATE : initialState) as AgReportState<StudioRegistry>} mode={mode} ai={ai} theme={theme} style={{ height: "calc(100vh - 108px)" }} />
    </AgStudioProvider>
  );
}
