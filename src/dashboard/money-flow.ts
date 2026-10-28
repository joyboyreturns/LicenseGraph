/**
 * The pure half of the "money flow" widget: what the buyer paid, split by who received it. Studio supplies the
 * rows; this groups and sizes them. Rows without a positive dollar amount (a run in another currency has none) are skipped.
 */
export interface FlowInput {
  payee: unknown;
  amount: unknown;
}

export interface FlowLine {
  payee: string;
  amount: number;
  /** 0..100, exact; the caller rounds for display. */
  sharePct: number;
}

export interface Flow {
  total: number;
  lines: FlowLine[];
}

export function buildFlow(rows: readonly FlowInput[]): Flow | undefined {
  const byPayee = new Map<string, number>();
  for (const r of rows) {
    const amount = typeof r.amount === "number" ? r.amount : Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const payee = r.payee === null || r.payee === undefined || r.payee === "" ? "Unnamed payee" : String(r.payee);
    byPayee.set(payee, Math.round(((byPayee.get(payee) ?? 0) + amount) * 100) / 100);
  }
  const total = Math.round([...byPayee.values()].reduce((a, b) => a + b, 0) * 100) / 100;
  if (!byPayee.size || total <= 0) return undefined;
  const lines = [...byPayee]
    .map(([payee, amount]) => ({ payee, amount, sharePct: (amount / total) * 100 }))
    .sort((a, b) => b.amount - a.amount || a.payee.localeCompare(b.payee));
  return { total, lines };
}
