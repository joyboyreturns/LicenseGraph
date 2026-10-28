import { describe, expect, it } from "vitest";
import { buildChart, buildKpi, buildLicenceTimeline, buildTable, catalogFrom, placeWidget, type StateLike } from "../src/dashboard/widget-tools";

const catalog = catalogFrom({
  sources: [
    { id: "offers", fields: [{ id: "asset", name: "Asset", format: "textFormat" }, { id: "price", name: "Price", format: "currencyFormat" }, { id: "status", format: "textFormat" }] },
    { id: "assets", fields: [{ id: "chosenPrice", format: "currencyFormat" }, { id: "cheapestPrice", format: "currencyFormat" }, { id: "asset", format: "textFormat" }] },
  ],
});

describe("catalogFrom", () => {
  it("lists fields as table.field and marks numeric ones", () => {
    expect(catalog.ids).toContain("offers.price");
    expect(catalog.numeric).toEqual(["offers.price", "assets.chosenPrice", "assets.cheapestPrice"]);
    expect(catalog.byId["offers.status"]).toMatchObject({ name: "status", numeric: false });
  });
});

describe("buildChart", () => {
  const args = { kind: "column" as const, title: "Price by asset", category: "offers.asset", value: "offers.price", aggregation: "sum" as const };

  it("builds a grouped column chart with a title, mapping and optional series", () => {
    const built = buildChart(catalog, { ...args, series: "offers.status" });
    expect(built).toMatchObject({
      ok: true,
      widget: {
        type: "column-chart-grouped",
        dataMapping: { categoryKey: [{ id: "offers.asset" }], valueKey: [{ id: "offers.price", aggregation: "sum" }], legendKey: [{ id: "offers.status" }] },
        format: { title: { enabled: true, text: "Price by asset" } },
      },
    });
  });

  it("maps each kind to its Studio widget type", () => {
    const type = (kind: "column" | "stacked-column" | "bar" | "line") => (buildChart(catalog, { ...args, kind }) as unknown as { widget: { type: string } }).widget.type;
    expect([type("column"), type("stacked-column"), type("bar"), type("line")]).toEqual(["column-chart-grouped", "column-chart-stacked", "bar-chart-grouped", "line-chart"]);
  });

  it("rejects unknown fields and says which are valid, so the model can retry", () => {
    const built = buildChart(catalog, { ...args, value: "offers.cost" });
    expect(built.ok).toBe(false);
    expect((built as { errors: string[] }).errors[0]).toMatch(/"offers.cost" is not a field.*offers.price/);
  });

  it("refuses to sum a text field but allows counting it", () => {
    expect(buildChart(catalog, { ...args, value: "offers.status" }).ok).toBe(false);
    expect(buildChart(catalog, { ...args, value: "offers.status", aggregation: "count" }).ok).toBe(true);
  });

  it("only splits into series by a text field", () => {
    const built = buildChart(catalog, { ...args, series: "assets.cheapestPrice" });
    expect(built.ok).toBe(false);
    expect((built as { errors: string[] }).errors[0]).toMatch(/is a number; use a text field/);
    expect(catalog.text).toEqual(["offers.asset", "offers.status", "assets.asset"]);
  });

  it("rejects an unknown chart kind", () => {
    expect(buildChart(catalog, { ...args, kind: "radar" as never }).ok).toBe(false);
  });
});

describe("buildTable and buildKpi", () => {
  it("builds a grid with the chosen columns, and refuses unknown or no columns", () => {
    expect(buildTable(catalog, { title: "T", columns: ["offers.asset", "offers.price"] })).toMatchObject({ ok: true, widget: { type: "grid", dataMapping: { cols: [{ id: "offers.asset" }, { id: "offers.price" }] } } });
    expect(buildTable(catalog, { title: "T", columns: [] }).ok).toBe(false);
    expect(buildTable(catalog, { title: "T", columns: ["nope"] }).ok).toBe(false);
  });

  it("builds a KPI and validates its field and aggregation", () => {
    expect(buildKpi(catalog, { title: "Spend", value: "assets.chosenPrice", aggregation: "sum" })).toMatchObject({ ok: true, widget: { type: "value", dataMapping: { value: [{ id: "assets.chosenPrice", aggregation: "sum" }] } } });
    expect(buildKpi(catalog, { title: "x", value: "offers.status", aggregation: "avg" }).ok).toBe(false);
  });
});

describe("placeWidget", () => {
  const state: StateLike = {
    selectedPageId: "overview",
    pages: [{ id: "overview", widgets: { a: { type: "grid" } }, widgetLayout: { a: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 6 }, b: { xTrack: 0, yTrack: 6, xSpan: 12, ySpan: 4 } } }],
  };

  it("adds the widget below everything else without mutating the old state", () => {
    const { state: next, widgetId } = placeWidget(state, "Price by asset", { type: "x" }, { xSpan: 6, ySpan: 5 });
    expect(widgetId).toBe("price-by-asset");
    expect(next.pages[0]!.widgetLayout!["price-by-asset"]).toEqual({ xTrack: 0, yTrack: 10, xSpan: 6, ySpan: 5 });
    expect(next.pages[0]!.widgets!["price-by-asset"]).toEqual({ type: "x" });
    expect(Object.keys(state.pages[0]!.widgets!)).toEqual(["a"]);
  });

  it("gives repeated titles unique ids and clamps the width to the grid", () => {
    const first = placeWidget(state, "Chart", { n: 1 }, { xSpan: 99, ySpan: 4 });
    const second = placeWidget(first.state, "Chart", { n: 2 }, { xSpan: 4, ySpan: 4 });
    expect(second.widgetId).toBe("chart-2");
    expect(first.state.pages[0]!.widgetLayout!["chart"]!.xSpan).toBe(12);
  });

  it("copes with an empty page and an untitled widget", () => {
    const empty: StateLike = { selectedPageId: "p", pages: [{ id: "p" }] };
    const { state: next, widgetId } = placeWidget(empty, "!!!", { z: 1 }, { xSpan: 3, ySpan: 3 });
    expect(widgetId).toBe("widget");
    expect(next.pages[0]!.widgetLayout!["widget"]).toMatchObject({ yTrack: 0 });
  });
});

describe("buildLicenceTimeline", () => {
  const portfolio = catalogFrom({ sources: [{ id: "licences", fields: [{ id: "label", format: "textFormat" }, { id: "boughtOn", format: "textFormat" }, { id: "endsOn", format: "textFormat" }] }] });

  it("maps the licences table's name, start and end onto the timeline widget", () => {
    expect(buildLicenceTimeline(portfolio, { title: "Ends" })).toMatchObject({
      ok: true,
      size: { xSpan: 12 },
      widget: { type: "licence-timeline", dataMapping: { label: [{ id: "licences.label" }], start: [{ id: "licences.boughtOn" }], end: [{ id: "licences.endsOn" }] }, format: { title: { text: "Ends" } } },
    });
  });

  it("says plainly that a dashboard without a licences table cannot draw one", () => {
    const run = catalogFrom({ sources: [{ id: "offers", fields: [{ id: "price", format: "currencyFormat" }] }] });
    const result = buildLicenceTimeline(run, { title: "Ends" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain('"licences.endsOn"');
  });
});
