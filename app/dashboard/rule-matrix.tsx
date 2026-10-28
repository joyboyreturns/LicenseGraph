"use client";

import type { AgDefaultWidgetDefinition, AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetFormParams, AgWidgetParams, AgWidgetsConfig } from "ag-studio";
import { createWidgets, type AgRegistry, type AgWidgetDefinition } from "ag-studio-react";
import { useEffect, useState } from "react";
import { buildMatrix, readRow, type Matrix } from "@/src/dashboard/rule-matrix";
import { licenceTimelineType, type LicenceTimelineDefinition } from "./licence-timeline";

/**
 * A custom AG Studio widget: a heat grid of which rule rejected which asset (or any two text fields and
 * a count). Studio supplies the data, filters and cross-filtering; the widget only draws the grid, so it
 * follows the page's filters like every built-in widget does.
 */

type MatrixMapping = { rows: AgWidgetFieldReference[]; columns: AgWidgetFieldReference[]; value: AgWidgetFieldReference[] };
interface MatrixDef extends AgWidgetData<MatrixMapping, AgWidgetDataFormat<unknown>> {
  type: "rule-matrix";
}
export type RuleMatrixDefinition = AgWidgetDefinition<"rule-matrix", MatrixDef>;
export interface StudioRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | RuleMatrixDefinition | LicenceTimelineDefinition)[];
}

const asList = (v: unknown): { id?: string }[] => (Array.isArray(v) ? v : v ? [v as { id?: string }] : []);

function RuleMatrix({ dataMapping, widgetApi }: AgWidgetParams<MatrixDef>) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);

  useEffect(() => {
    let live = true;
    const [row, column, value] = [asList(dataMapping.rows)[0], asList(dataMapping.columns)[0], asList(dataMapping.value)[0]];
    if (!row || !column || !value) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ kind: "flat", fields: [row, column, value] as never })
      .then(({ results }) => {
        if (!live) return;
        const ids: [string, string, string] = [String(row.id), String(column.id), String(value.id)];
        const built = buildMatrix(results.rows.map((r) => readRow(r, ids)));
        setMatrix(built);
        widgetApi.setDisplayState(built.total ? "displayed" : "noData");
      })
      .catch(() => live && widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
  }, [dataMapping, widgetApi]);

  if (!matrix?.total) return null;
  return (
    <div style={{ overflow: "auto", height: "100%", padding: 8, fontFamily: "var(--font-ui)", fontSize: 12.5 }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 3, minWidth: "100%" }}>
        <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          How many times each rule rejected each asset. {matrix.total} rejections in all.
        </caption>
        <thead>
          <tr>
            <td />
            {matrix.columns.map((c) => (
              <th key={c} scope="col" style={{ fontWeight: 600, textAlign: "center", padding: "2px 6px", color: "var(--muted)" }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r, i) => (
            <tr key={r}>
              <th scope="row" style={{ fontWeight: 600, textAlign: "left", padding: "2px 8px 2px 0", whiteSpace: "nowrap" }}>
                {r}
              </th>
              {matrix.cells[i]!.map((cell, j) => (
                <td
                  key={matrix.columns[j]}
                  title={cell ? `${r} was rejected ${cell.count} time${cell.count === 1 ? "" : "s"} by ${matrix.columns[j]}` : `${r}: no rejections by ${matrix.columns[j]}`}
                  style={{
                    textAlign: "center",
                    minWidth: 44,
                    height: 34,
                    borderRadius: 6,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                    background: cell ? `color-mix(in srgb, var(--bad-solid) ${Math.round(14 + cell.intensity * 74)}%, var(--surface))` : "var(--bg-sunk)",
                    color: cell && cell.intensity > 0.55 ? "#fff" : "var(--ink)",
                  }}
                >
                  {cell?.count ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Adds the widget to Studio's menu beside the built-in ones. */
export const widgets = (config: AgWidgetsConfig<StudioRegistry>) =>
  createWidgets<StudioRegistry>({
    additionalTypes: [
      {
        id: "rule-matrix",
        label: "Rule matrix",
        icon: '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="6" height="6" rx="1.2" fill="currentColor"/><rect x="9" y="1" width="6" height="6" rx="1.2" fill="currentColor" opacity=".45"/><rect x="1" y="9" width="6" height="6" rx="1.2" fill="currentColor" opacity=".45"/><rect x="9" y="9" width="6" height="6" rx="1.2" fill="currentColor" opacity=".8"/></svg>',
        dataMapping: {
          rows: { type: "field", supportedRoles: ["category"], requires: { cardinality: "one" }, required: true, intent: "category", aiDescription: "A text field: one grid row per value, for example the asset." },
          columns: { type: "field", supportedRoles: ["category"], requires: { cardinality: "one" }, required: true, intent: "pivot", aiDescription: "A text field: one grid column per value, for example the rule." },
          value: { type: "field", supportedRoles: ["numeric", "category"], requires: { cardinality: "one" }, required: true, intent: "value", aiDescription: "What to count in each cell, for example the violation id with the count aggregation." },
        },
        form: (params: AgWidgetFormParams<MatrixDef>) =>
          params.createDefaults({
            dataMappingItems: [
              { key: "rows", label: "Rows" },
              { key: "columns", label: "Columns" },
              { key: "value", label: "Count of" },
            ],
          }),
        comp: RuleMatrix,
        defaultSize: { width: 520, height: 320 },
        minSize: { width: 240, height: 160 },
      },
      licenceTimelineType,
    ],
    menu: [...config.menu, { label: "LicenseGraph", widgetIds: ["rule-matrix", "licence-timeline"] }],
  });
