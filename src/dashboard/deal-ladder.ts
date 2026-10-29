/**
 * The pure half of the "deal ladder" widget: every negotiation (a first run and the runs that answered a licensor or
 * changed its brief) as a short ladder of totals, so the dashboard shows what each step did to the price. Studio supplies
 * the rows; this groups, orders and works out the movement. Rows that belong to no negotiation are skipped.
 */
export interface LadderInput {
  deal: unknown;
  stage: unknown;
  step: unknown;
  total: unknown;
}

export interface LadderStep {
  stage: string;
  step: number;
  /** In dollars; null when that run found no compliant bundle. */
  total: number | null;
  /** Against the nearest earlier step that has a total; null for the first, or when either side has none. */
  change: number | null;
}

export interface Ladder {
  deal: string;
  steps: LadderStep[];
  /** First total to last total, when both exist. */
  netChange: number | null;
}

const cents = (n: number) => Math.round(n * 100);

export function buildLadders(rows: readonly LadderInput[]): Ladder[] {
  const byDeal = new Map<string, { stage: string; step: number; total: number | null }[]>();
  for (const r of rows) {
    if (r.deal === null || r.deal === undefined || r.deal === "") continue;
    const step = typeof r.step === "number" ? r.step : Number(r.step);
    if (!Number.isFinite(step)) continue;
    const total = r.total === null || r.total === undefined || r.total === "" ? null : Number(r.total);
    const list = byDeal.get(String(r.deal)) ?? [];
    list.push({ stage: r.stage === null || r.stage === undefined || r.stage === "" ? "Run" : String(r.stage), step, total: total !== null && Number.isFinite(total) ? total : null });
    byDeal.set(String(r.deal), list);
  }
  const ladders: Ladder[] = [];
  for (const [deal, list] of byDeal) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.step - b.step);
    const steps: LadderStep[] = list.map((s, i) => {
      const before = list.slice(0, i).reverse().find((x) => x.total !== null);
      return { ...s, change: s.total !== null && before ? (cents(s.total) - cents(before.total!)) / 100 : null };
    });
    const first = steps[0]!.total;
    const last = steps.at(-1)!.total;
    ladders.push({ deal, steps, netChange: first !== null && last !== null ? (cents(last) - cents(first)) / 100 : null });
  }
  return ladders.sort((a, b) => a.deal.localeCompare(b.deal));
}

/** One sentence per ladder, for the picture's accessible name. */
export function ladderSummary(l: Ladder): string {
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `${l.deal}: ${l.steps.map((s) => `${s.stage} ${s.total === null ? "no bundle" : money(s.total)}`).join(", then ")}${l.netChange === null ? "" : l.netChange === 0 ? ", no net change" : `, ${money(Math.abs(l.netChange))} ${l.netChange < 0 ? "less" : "more"} overall`}`;
}
