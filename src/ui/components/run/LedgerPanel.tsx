"use client";

import { ChevronDown, Link2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { sha256Hex } from "@/src/core/digest";
import { verifyChainAsync, type LedgerEvent } from "@/src/ledger/chain";
import type { Catalog } from "@/src/ui/lib/catalog";
import { eventActor, eventTitle, KIND_LABEL } from "@/src/ui/lib/event-text";
import { shortHash } from "@/src/ui/lib/format";
import { CopyButton, Spinner } from "../bits";
import styles from "./LedgerPanel.module.css";

type Check = { status: "idle" } | { status: "running" } | { status: "done"; ok: boolean; ms: number; count: number };

const ACTOR_LABEL = { agent: "Agent", engine: "Rules engine", human: "Person", payment: "Payments" } as const;

export function LedgerPanel({ events, chainValid, catalog, cursor }: { events: readonly LedgerEvent[]; chainValid: boolean; catalog: Catalog; cursor: number }) {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<Check>({ status: "idle" });

  const verify = useCallback(async () => {
    setCheck({ status: "running" });
    const t0 = performance.now();
    let ok = false;
    try {
      ok = await verifyChainAsync(events, sha256Hex);
    } catch {
      ok = false;
    }
    const ms = performance.now() - t0;
    // Keep the result on screen long enough to read as an action, even when hashing is instant.
    await new Promise((r) => setTimeout(r, Math.max(0, 450 - ms)));
    setCheck({ status: "done", ok, ms, count: events.length });
  }, [events]);

  return (
    <section className={`card ${styles.card}`} aria-labelledby="ledger-title">
      <div className={styles.head}>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls="ledger-body" onClick={() => setOpen((o) => !o)}>
          <ChevronDown aria-hidden className={styles.chev} data-open={open || undefined} />
          <span id="ledger-title" className="card-title">
            Ledger
          </span>
          <span className={styles.count}>{events.length} hash-chained events</span>
        </button>
        <span className={`chip chip-sm ${chainValid ? "tone-ok" : "tone-bad"}`} title="Checked by the server">
          {chainValid ? <ShieldCheck aria-hidden /> : <ShieldAlert aria-hidden />}
          {chainValid ? "Chain verified by the server" : "Chain broken"}
        </span>
        <span className="spacer" />
        <div className={styles.verify} aria-live="polite">
          {check.status === "done" && (
            <span className={`${styles.result} ${check.ok ? styles.ok : styles.bad}`}>
              {check.ok ? <ShieldCheck aria-hidden /> : <ShieldAlert aria-hidden />}
              {check.ok ? `Your browser recomputed ${check.count} SHA-256 hashes: chain intact` : "Your browser found a broken link in the chain"}
            </span>
          )}
          <button type="button" className="btn btn-sm" onClick={verify} disabled={check.status === "running" || events.length === 0}>
            {check.status === "running" ? <Spinner label="Verifying" /> : <Link2 aria-hidden />}
            {check.status === "running" ? "Hashing…" : "Verify in your browser"}
          </button>
        </div>
      </div>
      {open && (
        <div id="ledger-body" className={styles.body}>
          <p className={styles.explain}>
            Every step is appended to the ledger with the SHA-256 hash of the event before it, so changing, removing or reordering any event breaks every hash after it. The browser check above recomputes them all from the raw events.
          </p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Ledger events, oldest first">
            <table className={`table ${styles.table}`}>
              <caption className="visually-hidden">Ledger events, oldest first</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Event</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Time</th>
                  <th scope="col">Hash</th>
                  <th scope="col">Previous</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const actor = eventActor(e.kind);
                  return (
                    <tr key={e.seq} data-future={e.seq > cursor || undefined}>
                      <td className="num mono">{e.seq}</td>
                      <td>
                        <div className={styles.kind}>{KIND_LABEL[e.kind] ?? e.kind}</div>
                        <div className={styles.detail}>{eventTitle(e, catalog)}</div>
                      </td>
                      <td>
                        <span className={`chip chip-sm tone-${actor === "agent" ? "agent" : actor === "engine" ? "engine" : "neutral"}`}>{ACTOR_LABEL[actor]}</span>
                      </td>
                      <td className={`${styles.time} num`}>{new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.{String(new Date(e.at).getMilliseconds()).padStart(3, "0")}</td>
                      <td>
                        <span className={styles.hash}>
                          <code>{shortHash(e.hash, 12)}</code>
                          <CopyButton text={e.hash} label={`Copy hash of event ${e.seq}`} className={`btn btn-ghost btn-sm btn-icon ${styles.copy}`} announce="Hash copied" />
                        </span>
                      </td>
                      <td>
                        <code className={styles.prev}>{shortHash(e.prevHash, 8)}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
