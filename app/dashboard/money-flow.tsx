"use client";

import type { AgWidgetData, AgWidgetDataFormat, AgWidgetFieldReference, AgWidgetFormParams, AgWidgetParams } from "ag-studio";
import type { AgWidgetDefinition } from "ag-studio-react";
import { useEffect, useMemo, useState } from "react";
import { buildFlow, type FlowInput } from "@/src/dashboard/money-flow";
import { readRow } from "@/src/dashboard/rule-matrix";

/**
 * A custom AG Studio widget: what the buyers paid, drawn as bands flowing into each creator who received it.
 * Studio supplies the rows (so page filters and cross-filtering apply); the widget only sizes and draws them.
 */

type FlowMapping = { payee: AgWidgetFieldReference[]; amount: AgWidgetFieldReference[] };
export interface FlowDef extends AgWidgetData<FlowMapping, AgWidgetDataFormat<unknown>> {
  type: "money-flow";
}
export type MoneyFlowDefinition = AgWidgetDefinition<"money-flow", FlowDef>;

const asList = (v: unknown): { id?: string }[] => (Array.isArray(v) ? v : v ? [v as { id?: string }] : []);
const dollars = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const COLOURS = ["var(--engine-solid)", "var(--ok-solid)", "var(--agent-solid)", "var(--bad-solid)"];

const W = 640;
const H = 220;
const GAP = 6;
const LEFT = 16;
const RIGHT_X = 330;
const BAR = 14;

export function MoneyFlow({ dataMapping, widgetApi }: AgWidgetParams<FlowDef>) {
  const [rows, setRows] = useState<FlowInput[] | null>(null);

  useEffect(() => {
    let live = true;
    const [payee, amount] = [asList(dataMapping.payee)[0], asList(dataMapping.amount)[0]];
    if (!payee || !amount) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ kind: "flat", fields: [payee, amount] as never })
      .then(({ results }) => {
        if (!live) return;
        const ids: [string, string, string] = [String(payee.id), String(amount.id), ""];
        const read = results.rows.map((r) => {
          const x = readRow(r, ids);
          return { payee: x.row, amount: x.column };
        });
        setRows(read);
        widgetApi.setDisplayState(buildFlow(read) ? "displayed" : "noData");
      })
      .catch(() => live && widgetApi.setDisplayState("noData"));
    return () => {
      live = false;
    };
  }, [dataMapping, widgetApi]);

  const flow = useMemo(() => (rows ? buildFlow(rows) : undefined), [rows]);
  if (!flow) return null;

  const usable = H - GAP * (flow.lines.length - 1);
  let leftY = 0;
  let rightY = 0;
  const bands = flow.lines.map((l, i) => {
    const h = (l.sharePct / 100) * H;
    const rh = (l.sharePct / 100) * usable;
    const b = { ...l, colour: COLOURS[i % COLOURS.length]!, ly0: leftY, ly1: leftY + h, ry0: rightY, ry1: rightY + rh };
    leftY += h;
    rightY += rh + GAP;
    return b;
  });
  const xl = LEFT + BAR;
  const xm = (xl + RIGHT_X) / 2;

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "10px 12px", fontFamily: "var(--font-ui)", fontSize: 12.5 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Where the ${dollars(flow.total)} went: ${flow.lines.map((l) => `${l.payee} ${dollars(l.amount)}`).join(", ")}`} style={{ width: "100%", maxHeight: "100%", minWidth: 420 }}>
        <rect x={LEFT} y={0} width={BAR} height={H} rx={4} fill="var(--ink)" opacity={0.8} />
        <text x={LEFT + BAR + 8} y={14} fill="var(--muted)" fontSize={12}>
          Buyers paid
        </text>
        <text x={LEFT + BAR + 8} y={32} fill="var(--ink)" fontSize={15} fontWeight={650}>
          {dollars(flow.total)}
        </text>
        {bands.map((b) => (
          <g key={b.payee}>
            <path d={`M${xl},${b.ly0} C${xm},${b.ly0} ${xm},${b.ry0} ${RIGHT_X},${b.ry0} L${RIGHT_X},${b.ry1} C${xm},${b.ry1} ${xm},${b.ly1} ${xl},${b.ly1} Z`} fill={b.colour} opacity={0.35} />
            <rect x={RIGHT_X} y={b.ry0} width={BAR} height={Math.max(b.ry1 - b.ry0, 2)} rx={3} fill={b.colour} />
            <text x={RIGHT_X + BAR + 8} y={(b.ry0 + b.ry1) / 2 - 2} fill="var(--ink)" fontSize={13} fontWeight={600} dominantBaseline="middle">
              {b.payee}
            </text>
            <text x={RIGHT_X + BAR + 8} y={(b.ry0 + b.ry1) / 2 + 14} fill="var(--muted)" fontSize={12} dominantBaseline="middle">
              {dollars(b.amount)} · {Math.round(b.sharePct)}%
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export const moneyFlowType = {
  id: "money-flow" as const,
  label: "Money flow",
  icon: '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2" width="3" height="12" rx="1" fill="currentColor"/><path d="M4 3 C8 3 8 2 12 2 L12 6 C8 6 8 7 4 7 Z" fill="currentColor" opacity=".5"/><path d="M4 8 C8 8 8 10 12 10 L12 14 C8 14 8 14 4 14 Z" fill="currentColor" opacity=".75"/></svg>',
  dataMapping: {
    payee: { type: "field" as const, supportedRoles: ["category" as const], requires: { cardinality: "one" as const }, required: true, intent: "category" as const, aiDescription: "A text field naming who received the money, for example the licensor." },
    amount: { type: "field" as const, supportedRoles: ["numeric" as const], requires: { cardinality: "one" as const }, required: true, intent: "value" as const, aiDescription: "A number: the amount each row paid, in dollars." },
  },
  form: (params: AgWidgetFormParams<FlowDef>) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "payee", label: "Paid to" },
        { key: "amount", label: "Amount" },
      ],
    }),
  comp: MoneyFlow,
  defaultSize: { width: 620, height: 300 },
  minSize: { width: 420, height: 220 },
};
