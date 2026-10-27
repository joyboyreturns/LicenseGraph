"use client";

import type { AgReportState } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { buildStudioData } from "@/src/dashboard/data";

const initialState: AgReportState = {
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
          format: { title: { enabled: true, text: "Offer prices by asset (USD)" } },
        },
        violationsByRule: {
          type: "bar-chart-grouped",
          dataMapping: { categoryKey: [{ id: "violations.rule" }], valueKey: [{ id: "violations.violationId", aggregation: "count" }] },
          format: { title: { enabled: true, text: "Rules that rejected a proposal" } },
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
        rights: { xTrack: 0, yTrack: 5, xSpan: 12, ySpan: 6 },
        ledger: { xTrack: 0, yTrack: 11, xSpan: 12, ySpan: 6 },
      },
    },
  ],
};

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function Studio({ view }: { view: SessionView }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const data = useMemo(() => {
    const def = buildStudioData(view);
    // Money fields are in dollars; show them with a currency symbol.
    for (const source of def.sources) for (const f of source.fields) if (f.format === "currencyFormat") Object.assign(f, { formatOptions: { format: USD } });
    return def;
  }, [view]);
  return (
    <AgStudioProvider licenseKey={process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY}>
      <div style={{ display: "flex", gap: 8, padding: "8px 16px" }}>
        <button type="button" className={mode === "view" ? "primary" : ""} onClick={() => setMode("view")}>View</button>
        <button type="button" className={mode === "edit" ? "primary" : ""} onClick={() => setMode("edit")}>Edit dashboard</button>
      </div>
      <AgStudio data={data as never} initialState={initialState} mode={mode} style={{ height: "calc(100vh - 108px)" }} />
    </AgStudioProvider>
  );
}
