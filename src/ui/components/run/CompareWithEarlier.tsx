"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { compareRuns, type AssetChange } from "@/src/core/compare";
import { api } from "@/src/ui/lib/api";
import { buildCatalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney } from "@/src/ui/lib/format";
import { AssetIcon } from "../bits";
import styles from "./Insights.module.css";

const WORDS: Record<AssetChange, string> = {
  same: "Same licence",
  cheaper: "Cheaper licence",
  dearer: "Dearer licence",
  "other-licence": "Different licence, same price",
  gained: "Covered only now",
  lost: "No longer covered",
};

/**
 * This run beside the run it came from (a licensor's reply, or a changed brief): what each asset now costs and
 * which licence was chosen, from the verified bundles of both. The earlier run is only read, never changed.
 */
export function CompareWithEarlier({ view, earlierId }: { view: SessionView; earlierId: string }) {
  const [earlier, setEarlier] = useState<SessionView | null | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    api<SessionView>(`/api/sessions/${encodeURIComponent(earlierId)}`, { signal: c.signal }).then(setEarlier, () => !c.signal.aborted && setEarlier(null));
    return () => c.abort();
  }, [earlierId]);

  const result = useMemo(() => (earlier ? compareRuns(earlier.bundle, view.bundle) : undefined), [earlier, view.bundle]);
  const names = useMemo(() => {
    const now = buildCatalog(view.documents, view.candidates);
    const was = earlier ? buildCatalog(earlier.documents, earlier.candidates) : undefined;
    return (offerId?: string) => (offerId ? (now.offer(offerId)?.licensor ?? was?.offer(offerId)?.licensor ?? offerId) : "");
  }, [view.documents, view.candidates, earlier]);

  if (!earlier || !result || !result.assets.length) return null;
  const { deltaCents, currency } = result;
  return (
    <section className="card" aria-labelledby="compare-title" data-testid="compare-earlier">
      <div className="card-head">
        <h2 id="compare-title" className="card-title">
          Compared with the run it came from
        </h2>
        <Link prefetch={false} className="small" href={`/run/${earlier.id}`}>
          Open that run
        </Link>
      </div>
      <div className={styles.levers}>
        <p className="small ink-2" style={{ marginBottom: 10 }}>
          {earlier.bundle ? `That run's verified bundle cost ${formatMoney(earlier.bundle.totalCents, earlier.bundle.currency)}.` : "That run found no compliant bundle."}{" "}
          {view.bundle ? `This one costs ${formatMoney(view.bundle.totalCents, view.bundle.currency)}` : "This one found no compliant bundle"}
          {deltaCents === null ? "." : deltaCents === 0 ? ", the same." : `, ${formatMoney(Math.abs(deltaCents), currency!)} ${deltaCents < 0 ? "less" : "more"}.`}
        </p>
        <ul className={styles.list}>
          {result.assets.map((a) => (
            <li key={a.assetId} className={styles.lever}>
              <span className={styles.name}>
                <AssetIcon assetId={a.assetId} size={14} /> {assetLabel(a.assetId)}
              </span>
              <span className={`${styles.extra} num`} data-free={a.change === "cheaper" || a.change === "same" ? "true" : undefined}>
                {WORDS[a.change]}
              </span>
              <span className={styles.hint}>
                {a.before ? `${names(a.before.offerId)} at ${formatMoney(a.before.priceCents, earlier.bundle!.currency)}` : "Nothing was bought"}
                {" → "}
                {a.after ? `${names(a.after.offerId)} at ${formatMoney(a.after.priceCents, view.bundle!.currency)}` : "nothing bought"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
