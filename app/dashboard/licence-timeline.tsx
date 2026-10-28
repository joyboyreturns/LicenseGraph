"use client";

import type { AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetFormParams, AgWidgetParams } from "ag-studio";
import type { AgWidgetDefinition } from "ag-studio-react";
import { useEffect, useMemo, useState } from "react";
import { buildTimeline, type TimelineBar, type TimelineInput, type Urgency } from "@/src/dashboard/licence-timeline";
import { readRow } from "@/src/dashboard/rule-matrix";

/**
 * A custom AG Studio widget: every bought licence as a bar from the day of purchase to the day it stops
 * covering the project, on one axis, with a "today" line and the licences that end soon highlighted. Studio
 * supplies the rows (so page filters and cross-filtering apply); the widget only draws them.
 */

type TimelineMapping = { label: AgWidgetFieldReference[]; start: AgWidgetFieldReference[]; end: AgWidgetFieldReference[] };
export interface TimelineDef extends AgWidgetData<TimelineMapping, AgWidgetDataFormat<unknown>> {
  type: "licence-timeline";
}
export type LicenceTimelineDefinition = AgWidgetDefinition<"licence-timeline", TimelineDef>;

const asList = (v: unknown): { id?: string }[] => (Array.isArray(v) ? v : v ? [v as { id?: string }] : []);
const todayIso = () => new Date().toISOString().slice(0, 10);

const COLOUR: Record<Urgency, string> = {
  ended: "var(--bad-solid)",
  soon: "var(--agent-solid)",
  later: "var(--engine-solid)",
  perpetual: "var(--ok-solid)",
};
const STATE: Record<Urgency, string> = { ended: "Ended", soon: "Ends soon", later: "Covered", perpetual: "Perpetual" };

const describe = (b: TimelineBar) =>
  b.perpetual ? `${b.label}: perpetual, from ${b.start}` : `${b.label}: ${b.start} to ${b.end}, ${b.daysLeft! < 0 ? `ended ${-b.daysLeft!} days ago` : `${b.daysLeft} days left`}`;

export function LicenceTimeline({ dataMapping, widgetApi }: AgWidgetParams<TimelineDef>) {
  const [rows, setRows] = useState<TimelineInput[] | null>(null);

  useEffect(() => {
    let live = true;
    const [label, start, end] = [asList(dataMapping.label)[0], asList(dataMapping.start)[0], asList(dataMapping.end)[0]];
    if (!label || !start || !end) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ kind: "flat", fields: [label, start, end] as never })
      .then(({ results }) => {
        if (!live) return;
        const ids: [string, string, string] = [String(label.id), String(start.id), String(end.id)];
        const read = results.rows.map((r) => {
          const x = readRow(r, ids);
          return { label: x.row, start: x.column, end: x.value };
        });
        setRows(read);
        widgetApi.setDisplayState(read.length ? "displayed" : "noData");
      })
      .catch(() => live && widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
  }, [dataMapping, widgetApi]);

  const timeline = useMemo(() => (rows ? buildTimeline(rows, todayIso()) : undefined), [rows]);
  if (!timeline) return null;

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "10px 12px", fontFamily: "var(--font-ui)", fontSize: 12.5 }}>
      <div role="list" aria-label="Licence end dates" style={{ display: "grid", gridTemplateColumns: "minmax(120px, 22%) 1fr", rowGap: 6, columnGap: 10, minWidth: 420, position: "relative" }}>
        <div />
        <div style={{ position: "relative", height: 16, color: "var(--muted)" }} aria-hidden>
          {timeline.ticks.map((t) => (
            <span key={t.label} style={{ position: "absolute", left: `${t.pct}%`, transform: "translateX(-50%)", fontVariantNumeric: "tabular-nums" }}>
              {t.label}
            </span>
          ))}
        </div>
        {timeline.bars.map((b) => (
          <div key={`${b.label}-${b.start}`} role="listitem" style={{ display: "contents" }}>
            <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={describe(b)}>
              {b.label}
            </span>
            <div style={{ position: "relative", height: 22, background: "var(--bg-sunk)", borderRadius: 6 }} title={describe(b)}>
              {timeline.ticks.map((t) => (
                <span key={t.label} aria-hidden style={{ position: "absolute", left: `${t.pct}%`, top: 0, bottom: 0, width: 1, background: "var(--line)" }} />
              ))}
              <span
                role="img"
                aria-label={`${describe(b)} (${STATE[b.urgency]})`}
                style={{ position: "absolute", left: `${b.startPct}%`, width: `${Math.max(b.endPct - b.startPct, 0.8)}%`, top: 3, bottom: 3, borderRadius: b.perpetual ? "5px 0 0 5px" : 5, background: COLOUR[b.urgency], clipPath: b.perpetual ? "polygon(0 0, 96% 0, 100% 50%, 96% 100%, 0 100%)" : undefined }}
              />
              <span aria-hidden style={{ position: "absolute", left: `${timeline.todayPct}%`, top: -2, bottom: -2, width: 2, background: "var(--ink)", opacity: 0.7 }} title="Today" />
            </div>
          </div>
        ))}
      </div>
      <p style={{ margin: "10px 0 0", color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: 14 }}>
        {(Object.keys(STATE) as Urgency[]).map((u) => (
          <span key={u} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: COLOUR[u] }} /> {STATE[u]}
          </span>
        ))}
        <span>The dark line is today.</span>
      </p>
    </div>
  );
}

export const licenceTimelineType = {
  id: "licence-timeline" as const,
  label: "Licence timeline",
  icon: '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="9" height="3" rx="1.2" fill="currentColor"/><rect x="4" y="6.5" width="11" height="3" rx="1.2" fill="currentColor" opacity=".6"/><rect x="2" y="11" width="6" height="3" rx="1.2" fill="currentColor" opacity=".8"/></svg>',
  dataMapping: {
    label: { type: "field" as const, supportedRoles: ["category" as const], requires: { cardinality: "one" as const }, required: true, intent: "category" as const, aiDescription: "A text field naming each licence, for example licensor and asset." },
    start: { type: "field" as const, supportedRoles: ["category" as const], requires: { cardinality: "one" as const }, required: true, intent: "pivot" as const, aiDescription: "A text field holding the start date as YYYY-MM-DD, for example the day of purchase." },
    end: { type: "field" as const, supportedRoles: ["category" as const], requires: { cardinality: "one" as const }, required: true, intent: "value" as const, aiDescription: "A text field holding the end date as YYYY-MM-DD; any other text (such as Perpetual) draws a licence with no end." },
  },
  form: (params: AgWidgetFormParams<TimelineDef>) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "label", label: "Licence" },
        { key: "start", label: "Starts" },
        { key: "end", label: "Ends" },
      ],
    }),
  comp: LicenceTimeline,
  defaultSize: { width: 620, height: 300 },
  minSize: { width: 320, height: 160 },
};
