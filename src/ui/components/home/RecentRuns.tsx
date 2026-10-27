"use client";

import { ArrowRight, History, Radio } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/src/ui/lib/api";
import { formatMoney, phaseInfo, pluralise, relativeTime } from "@/src/ui/lib/format";
import type { RunSummary } from "./types";
import styles from "./Home.module.css";

export function RecentRuns() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    api<{ runs: RunSummary[] }>("/api/sessions")
      .then((r) => setRuns(r.runs))
      .catch(() => setRuns([]));
  }, []);
  if (!runs || runs.length === 0) return null;
  return (
    <section className={`container ${styles.section}`} aria-labelledby="recent-title">
      <div className={styles.recentHead}>
        <div>
          <p className="eyebrow">On this server</p>
          <h2 id="recent-title" className="section-title">
            Recent runs
          </h2>
        </div>
        <Link prefetch={false} href="/dashboard" className="btn btn-ghost">
          All runs in the portfolio <ArrowRight aria-hidden />
        </Link>
      </div>
      <ul className={styles.runs}>
        {runs.slice(0, 6).map((r) => {
          const p = phaseInfo(r.phase);
          return (
            <li key={r.id}>
              <Link prefetch={false} href={`/run/${r.id}`} className={styles.run}>
                <span className={styles.runMain}>
                  <span className={styles.runName}>{r.name}</span>
                  <span className={styles.runMeta}>
                    {r.runKind === "live" ? <Radio aria-hidden /> : <History aria-hidden />}
                    {r.runKind === "live" ? "Live model" : "Replayed scenario"} · {relativeTime(r.createdAt, now)}
                    {r.rounds ? ` · ${pluralise(r.rounds, "round")}` : ""}
                  </span>
                </span>
                <span className={styles.runRight}>
                  <span className={`chip chip-sm tone-${p.tone}`}>{p.label}</span>
                  <span className={`${styles.runTotal} num`}>{r.totalCents !== undefined ? formatMoney(r.totalCents, r.currency) : "—"}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
