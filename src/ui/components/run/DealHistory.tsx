"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { dealHistory, type HistoryKind, type HistoryRun } from "@/src/core/deal-history";
import { api } from "@/src/ui/lib/api";
import { formatMoney } from "@/src/ui/lib/format";
import styles from "./Insights.module.css";

const KIND: Record<HistoryKind, string> = { original: "First run", reply: "After a licensor's reply", brief: "Changed brief" };

const outcome = (s: { phase: string; paid: boolean; totalCents: number | null; currency: string | null }) =>
  s.paid ? `Paid ${formatMoney(s.totalCents!, s.currency!)}` : s.totalCents !== null ? `Verified at ${formatMoney(s.totalCents, s.currency!)}` : s.phase === "failed" ? "No compliant bundle" : "In progress";

/**
 * Every run of one negotiation in order: the first read of the licences, each licensor reply and each change of brief,
 * with where the total went. Shown only when the run is part of one, and only to the browser that owns the runs.
 */
export function DealHistory({ runId }: { runId: string }) {
  const [runs, setRuns] = useState<HistoryRun[] | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api<{ runs: HistoryRun[] }>("/api/sessions", { signal: c.signal }).then((r) => setRuns(r.runs), () => undefined);
    return () => c.abort();
  }, [runId]);
  const steps = useMemo(() => (runs ? dealHistory(runs, runId) : []), [runs, runId]);
  if (steps.length < 2) return null;
  return (
    <section className="card" aria-labelledby="deal-title" data-testid="deal-history">
      <div className="card-head">
        <h2 id="deal-title" className="card-title">
          This deal so far
        </h2>
        <span className="small muted">{steps.length} runs, oldest first</span>
      </div>
      <div className={styles.levers}>
        <ol className={styles.list}>
          {steps.map((s) => (
            <li key={s.id} className={styles.lever}>
              <span className={styles.name}>
                {s.current ? (
                  <b aria-current="step">{KIND[s.kind]} (this run)</b>
                ) : (
                  <Link prefetch={false} href={`/run/${s.id}`}>
                    {KIND[s.kind]}
                  </Link>
                )}
              </span>
              <span className={`${styles.extra} num`} data-free={s.deltaCents !== null && s.deltaCents < 0 ? "true" : undefined}>
                {s.deltaCents === null ? "" : s.deltaCents === 0 ? "no change" : `${s.deltaCents < 0 ? "−" : "+"}${formatMoney(Math.abs(s.deltaCents), s.currency!)}`}
              </span>
              <span className={styles.hint}>{outcome(s)}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
