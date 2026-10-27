/**
 * Plain-parameter widget builders for the dashboard assistant. A small model is much more reliable
 * choosing from closed lists (chart type, field) than writing Studio's full widget configuration,
 * so the assistant gets a few simple tools and this module turns their arguments into widget state.
 */

export const AGGREGATIONS = ["sum", "avg", "min", "max", "count", "countd"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const CHART_TYPES = {
  column: "column-chart-grouped",
  "stacked-column": "column-chart-stacked",
  bar: "bar-chart-grouped",
  line: "line-chart",
} as const;
export type ChartKind = keyof typeof CHART_TYPES;

interface FieldInfo {
  id: string;
  name: string;
  numeric: boolean;
}

export interface FieldCatalog {
  /** Every field as "table.field". */
  ids: string[];
  /** Fields that hold numbers (valid to sum or average). */
  numeric: string[];
  /** Fields that hold text (valid as categories or series). */
  text: string[];
  byId: Record<string, FieldInfo>;
}

type Def = { sources: { id: string; fields: { id: string; name?: string; format: string }[] }[] };

export function catalogFrom(def: Def): FieldCatalog {
  const byId: Record<string, FieldInfo> = {};
  for (const s of def.sources) {
    for (const f of s.fields) {
      const id = `${s.id}.${f.id}`;
      byId[id] = { id, name: f.name ?? f.id, numeric: ["currencyFormat", "integerFormat", "decimalFormat", "percentageFormat"].includes(f.format) };
    }
  }
  const ids = Object.keys(byId);
  return { ids, numeric: ids.filter((i) => byId[i]!.numeric), text: ids.filter((i) => !byId[i]!.numeric), byId };
}

export type Built<W> = { ok: true; widget: W; size: { xSpan: number; ySpan: number } } | { ok: false; errors: string[] };

const known = (c: FieldCatalog, id: string, label: string, errors: string[]) => {
  if (!c.byId[id]) errors.push(`${label} "${id}" is not a field. Use one of: ${c.ids.join(", ")}.`);
};

function checkAggregation(c: FieldCatalog, valueField: string, aggregation: Aggregation, errors: string[]) {
  if (c.byId[valueField] && !c.byId[valueField]!.numeric && aggregation !== "count" && aggregation !== "countd") {
    errors.push(`"${valueField}" is not a number, so it can only be counted ("count" or "countd"), not "${aggregation}". Numeric fields: ${c.numeric.join(", ")}.`);
  }
}

export interface ChartArgs {
  kind: ChartKind;
  title: string;
  category: string;
  value: string;
  aggregation: Aggregation;
  /** Optional field whose values become separate series. */
  series?: string;
}

export function buildChart(c: FieldCatalog, a: ChartArgs): Built<Record<string, unknown>> {
  const errors: string[] = [];
  if (!(a.kind in CHART_TYPES)) errors.push(`Chart kind must be one of: ${Object.keys(CHART_TYPES).join(", ")}.`);
  known(c, a.category, "Category field", errors);
  known(c, a.value, "Value field", errors);
  if (a.series) {
    known(c, a.series, "Series field", errors);
    if (c.byId[a.series]?.numeric) errors.push(`Series field "${a.series}" is a number; use a text field to split the chart into series.`);
  }
  checkAggregation(c, a.value, a.aggregation, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    size: { xSpan: 6, ySpan: 5 },
    widget: {
      type: CHART_TYPES[a.kind],
      dataMapping: {
        categoryKey: [{ id: a.category }],
        valueKey: [{ id: a.value, aggregation: a.aggregation }],
        ...(a.series ? { legendKey: [{ id: a.series }] } : {}),
      },
      format: { title: { enabled: true, text: a.title } },
    },
  };
}

export interface TableArgs {
  title: string;
  columns: string[];
}

export function buildTable(c: FieldCatalog, a: TableArgs): Built<Record<string, unknown>> {
  const errors: string[] = [];
  if (a.columns.length === 0) errors.push("Choose at least one column.");
  a.columns.forEach((id) => known(c, id, "Column", errors));
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    size: { xSpan: 12, ySpan: 5 },
    widget: { type: "grid", dataMapping: { cols: a.columns.map((id) => ({ id })) }, format: { title: { enabled: true, text: a.title } } },
  };
}

export interface KpiArgs {
  title: string;
  value: string;
  aggregation: Aggregation;
}

export function buildKpi(c: FieldCatalog, a: KpiArgs): Built<Record<string, unknown>> {
  const errors: string[] = [];
  known(c, a.value, "Value field", errors);
  checkAggregation(c, a.value, a.aggregation, errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    size: { xSpan: 3, ySpan: 3 },
    widget: { type: "value", dataMapping: { value: [{ id: a.value, aggregation: a.aggregation }] }, format: { title: { enabled: true, text: a.title } } },
  };
}

type Layout = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
export interface PageLike {
  id: string;
  widgets?: Partial<Record<string, unknown>>;
  widgetLayout?: Partial<Record<string, Layout>>;
}
export interface StateLike {
  selectedPageId: string;
  pages: PageLike[];
}

const COLUMNS = 12;

/** Put a new widget on the selected page, below everything already there. Returns new state; never mutates. */
export function placeWidget<S extends StateLike>(state: S, title: string, widget: unknown, size: { xSpan: number; ySpan: number }): { state: S; widgetId: string } {
  const page = state.pages.find((p) => p.id === state.selectedPageId) ?? state.pages[0];
  if (!page) throw new Error("The dashboard has no page to add to.");

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "widget";
  let widgetId = slug;
  for (let n = 2; page.widgets?.[widgetId]; n++) widgetId = `${slug}-${n}`;

  const bottom = Object.values(page.widgetLayout ?? {}).reduce((max, l) => (l ? Math.max(max, l.yTrack + l.ySpan) : max), 0);
  const layout: Layout = { xTrack: 0, yTrack: bottom, xSpan: Math.min(size.xSpan, COLUMNS), ySpan: size.ySpan };

  const nextPage: PageLike = { ...page, widgets: { ...page.widgets, [widgetId]: widget }, widgetLayout: { ...page.widgetLayout, [widgetId]: layout } };
  return { state: { ...state, pages: state.pages.map((p) => (p === page ? nextPage : p)) }, widgetId };
}
