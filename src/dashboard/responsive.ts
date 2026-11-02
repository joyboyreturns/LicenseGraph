import type { AgBaseRegistry, AgReportState } from "ag-studio";

/** Stack widgets at readable widths without changing the saved desktop arrangement. */
export function phoneDashboard<T extends AgBaseRegistry>(state: AgReportState<T>): AgReportState<T> {
  return {
    ...state,
    panels: Object.fromEntries(["filters", "edit", "data", "ai"].map((id) => [id, { ...state.panels?.[id], collapsed: true }])),
    pages: state.pages.map((page) => {
      let y = 0;
      const entries = Object.entries(page.widgets ?? {}).sort(([a], [b]) => {
        const left = page.widgetLayout?.[a];
        const right = page.widgetLayout?.[b];
        return (left?.yTrack ?? 0) - (right?.yTrack ?? 0) || (left?.xTrack ?? 0) - (right?.xTrack ?? 0);
      });
      return {
        ...page,
        layout: { ...page.layout, columns: 12, minWidth: 0 },
        widgetLayout: Object.fromEntries(entries.map(([id, widget]) => {
          const height = widget?.type === "value" ? 3 : Math.max(5, page.widgetLayout?.[id]?.ySpan ?? 5);
          const position = { xTrack: 0, yTrack: y, xSpan: 12, ySpan: height };
          y += height;
          return [id, position];
        })),
      };
    }),
  };
}
