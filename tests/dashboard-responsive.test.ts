import { describe, expect, it } from "vitest";
import type { AgReportState } from "ag-studio";
import { phoneDashboard } from "../src/dashboard/responsive";

describe("phone dashboard", () => {
  it("stacks widgets in reading order, closes panels, and preserves the desktop state and widgets", () => {
    const desktop: AgReportState = { selectedPageId: "overview", panels: { filters: { collapsed: false, width: 300 } }, pages: [{
      id: "overview", layout: { columns: 12, rowHeight: 56 },
      widgets: { chart: { type: "bar-chart-grouped", dataMapping: { categoryKey: [{ id: "offers.asset" }], valueKey: [{ id: "offers.price", aggregation: "sum" }] } }, value: { type: "value", dataMapping: { value: [{ id: "assets.chosenPrice", aggregation: "sum" }] } }, later: { type: "grid", dataMapping: { cols: [{ id: "offers.asset" }] } } },
      widgetLayout: { chart: { xTrack: 3, yTrack: 0, xSpan: 9, ySpan: 5 }, value: { xTrack: 0, yTrack: 0, xSpan: 3, ySpan: 3 }, later: { xTrack: 0, yTrack: 5, xSpan: 12, ySpan: 6 } },
    }] };
    const original = structuredClone(desktop);
    const phone = phoneDashboard(desktop);
    expect(phone.pages[0]!.widgetLayout).toEqual({
      value: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 3 },
      chart: { xTrack: 0, yTrack: 3, xSpan: 12, ySpan: 5 },
      later: { xTrack: 0, yTrack: 8, xSpan: 12, ySpan: 6 },
    });
    expect(phone.pages[0]!.layout?.minWidth).toBe(0);
    expect(phone.panels?.filters).toEqual({ collapsed: true, width: 300 });
    expect(phone.pages[0]!.widgets).toEqual(desktop.pages[0]!.widgets);
    expect(desktop).toEqual(original);
    expect(phoneDashboard(phone)).toEqual(phone);
  });
});
