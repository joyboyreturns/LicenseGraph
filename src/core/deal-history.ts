/** The fields of a run that the history needs: what the run list already carries. */
export interface HistoryRun {
  id: string;
  createdAt: string;
  phase: string;
  revisedFrom?: string;
  rebriefedFrom?: string;
  totalCents?: number;
  currency?: string;
  paid: boolean;
}

export type HistoryKind = "original" | "reply" | "brief";

export interface HistoryStep {
  id: string;
  kind: HistoryKind;
  phase: string;
  paid: boolean;
  totalCents: number | null;
  currency: string | null;
  /** Movement of the total against the run this one came from, when both have a bundle in the same currency. */
  deltaCents: number | null;
  current: boolean;
}

const sourceOf = (r: HistoryRun) => r.revisedFrom ?? r.rebriefedFrom;

/**
 * Every run that belongs to the same negotiation as `currentId`: the run it started from, the runs that answered a
 * licensor or changed the brief, and the runs those led to, oldest first. Empty when the run stands alone.
 */
export function dealHistory(runs: readonly HistoryRun[], currentId: string): HistoryStep[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  if (!byId.has(currentId)) return [];
  const linked = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!linked.has(a)) linked.set(a, new Set());
    if (!linked.has(b)) linked.set(b, new Set());
    linked.get(a)!.add(b);
    linked.get(b)!.add(a);
  };
  for (const r of runs) {
    const s = sourceOf(r);
    if (s && byId.has(s)) link(r.id, s);
  }
  const seen = new Set<string>([currentId]);
  const queue = [currentId];
  while (queue.length) for (const next of linked.get(queue.shift()!) ?? []) if (!seen.has(next)) (seen.add(next), queue.push(next));
  if (seen.size < 2) return [];
  return runs
    .filter((r) => seen.has(r.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((r): HistoryStep => {
      const s = sourceOf(r);
      const src = s ? byId.get(s) : undefined;
      const comparable = r.totalCents !== undefined && src?.totalCents !== undefined && r.currency === src.currency;
      return {
        id: r.id,
        kind: r.revisedFrom ? "reply" : r.rebriefedFrom ? "brief" : "original",
        phase: r.phase,
        paid: r.paid,
        totalCents: r.totalCents ?? null,
        currency: r.currency ?? null,
        deltaCents: comparable ? r.totalCents! - src!.totalCents! : null,
        current: r.id === currentId,
      };
    });
}
