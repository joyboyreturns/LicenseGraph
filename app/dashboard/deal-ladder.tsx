"use client";

import type { AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetFormParams, AgWidgetParams } from "ag-studio";
import type { AgWidgetDefinition } from "ag-studio-react";
import { useEffect, useMemo, useState } from "react";
import { buildLadders, ladderSummary, type LadderInput } from "@/src/dashboard/deal-ladder";

/**
 * A custom AG Studio widget: each negotiation (a first run, then every licensor reply and changed brief) as a ladder of
 * totals, so the dashboard shows what each step did to the price. Studio supplies the rows, so page filters and
 * cross-filtering apply; the widget only orders and draws them.
 */

type LadderMapping = { deal: AgWidgetFieldReference[]; stage: AgWidgetFieldReference[]; step: AgWidgetFieldReference[]; total: AgWidgetFieldReference[] };
export interface LadderDef extends AgWidgetData<LadderMapping, AgWidgetDataFormat<unknown>> {
  type: "deal-ladder";
}
export type DealLadderDefinition = AgWidgetDefinition<"deal-ladder", LadderDef>;

const asList = (v: unknown): { id?: string }[] => (Array.isArray(v) ? v : v ? [v as { id?: string }] : []);
const dollars = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** A flat Studio row keyed by field id; when the keys are not the ids, fall back to the order the fields were requested in. */
const readFour = (row: Record<string, unknown>, ids: string[]): unknown[] => (ids.every((id) => id in row) ? ids.map((id) => row[id]) : Object.values(row).slice(0, ids.length));

const W = 560;
const ROW_H = 86;
const PAD_X = 56;

export function DealLadder(params: AgWidgetParams<LadderDef>) {
  const { dataMapping, widgetApi } = params;
  const [rows, setRows] = useState<LadderInput[] | null>(null);

  // Studio refreshes params for data and filter changes even when the field mapping stays the same.
  useEffect(() => {
    let live = true;
    const fields = [asList(dataMapping.deal)[0], asList(dataMapping.stage)[0], asList(dataMapping.step)[0], asList(dataMapping.total)[0]];
    if (fields.some((f) => !f)) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ kind: "flat", fields: fields as never })
      .then(({ results }) => {
        if (!live) return;
        const ids = fields.map((f) => String(f!.id));
        const read = results.rows.map((r) => {
          const [deal, stage, step, total] = readFour(r, ids);
          return { deal, stage, step, total };
        });
        setRows(read);
        widgetApi.setDisplayState(buildLadders(read).length ? "displayed" : "noData");
      })
      .catch(() => live && widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
  }, [params]);

  const ladders = useMemo(() => (rows ? buildLadders(rows) : []), [rows]);
  // Keep a DOM node while empty so Studio can finish mounting and deliver later refreshes.
  if (!ladders.length) return <div aria-hidden />;

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "10px 12px", fontFamily: "var(--font-ui)", fontSize: 12.5 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14, minWidth: 420 }} aria-label="Negotiations, each as a ladder of totals">
        {ladders.map((l) => {
          const totals = l.steps.map((s) => s.total).filter((t): t is number => t !== null);
          const lo = Math.min(...totals);
          const hi = Math.max(...totals);
          const span = hi - lo || 1;
          const x = (i: number) => (l.steps.length === 1 ? W / 2 : PAD_X + (i * (W - PAD_X * 2)) / (l.steps.length - 1));
          const y = (t: number) => 30 + (1 - (t - lo) / span) * (ROW_H - 64);
          const points = l.steps.flatMap((s, i) => (s.total === null ? [] : [{ x: x(i), y: y(s.total), s }]));
          return (
            <li key={l.deal}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: 650 }}>
                <span>{l.deal}</span>
                {l.netChange !== null && <span style={{ color: l.netChange < 0 ? "var(--ok)" : "var(--ink-2)" }}>{l.netChange === 0 ? "no net change" : `${l.netChange < 0 ? "−" : "+"}${dollars(Math.abs(l.netChange))} overall`}</span>}
              </div>
              <svg viewBox={`0 0 ${W} ${ROW_H}`} role="img" aria-label={ladderSummary(l)} style={{ width: "100%", maxHeight: ROW_H + 20 }}>
                {points.length > 1 && <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--engine-solid)" strokeWidth={2} />}
                {l.steps.map((s, i) => (
                  <g key={s.step}>
                    {s.total === null ? (
                      <text x={x(i)} y={ROW_H / 2} textAnchor="middle" fill="var(--bad)" fontSize={12}>
                        no bundle
                      </text>
                    ) : (
                      <>
                        <circle cx={x(i)} cy={y(s.total)} r={5} fill={s.change !== null && s.change < 0 ? "var(--ok-solid)" : "var(--engine-solid)"} />
                        <text x={x(i)} y={y(s.total) - 10} textAnchor="middle" fill="var(--ink)" fontSize={13} fontWeight={650}>
                          {dollars(s.total)}
                        </text>
                      </>
                    )}
                    <text x={x(i)} y={ROW_H - 4} textAnchor="middle" fill="var(--muted)" fontSize={11}>
                      {s.stage}
                      {s.change !== null && s.change !== 0 ? ` (${s.change < 0 ? "−" : "+"}${dollars(Math.abs(s.change))})` : ""}
                    </text>
                  </g>
                ))}
              </svg>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const dealLadderType = {
  id: "deal-ladder" as const,
  label: "Deal ladder",
  icon: '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="3" cy="4" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor" opacity=".75"/><circle cx="13" cy="12" r="1.6" fill="currentColor" opacity=".5"/><path d="M3 4 L8 8 L13 12" stroke="currentColor" fill="none" stroke-width="1.2"/></svg>',
  dataMapping: {
    deal: { type: "field" as const, supportedRoles: ["category" as const], requires: { cardinality: "one" as const }, required: true, intent: "category" as const, aiDescription: "A text field naming the negotiation a run belongs to." },
    stage: { type: "field" as const, supportedRoles: ["category" as const], requires: { cardinality: "one" as const }, required: true, intent: "category" as const, aiDescription: "A text field saying what kind of step the run was: the first run, after a licensor reply, or a changed brief." },
    step: { type: "field" as const, supportedRoles: ["numeric" as const], requires: { cardinality: "one" as const }, required: true, intent: "value" as const, aiDescription: "A number: the step's position in the negotiation, counting from 1." },
    total: { type: "field" as const, supportedRoles: ["numeric" as const], requires: { cardinality: "one" as const }, required: true, intent: "value" as const, aiDescription: "A number: the run's verified total, in dollars." },
  },
  form: (params: AgWidgetFormParams<LadderDef>) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "deal", label: "Negotiation" },
        { key: "stage", label: "Step type" },
        { key: "step", label: "Step number" },
        { key: "total", label: "Verified total" },
      ],
    }),
  comp: DealLadder,
  defaultSize: { width: 620, height: 300 },
  minSize: { width: 420, height: 180 },
};
