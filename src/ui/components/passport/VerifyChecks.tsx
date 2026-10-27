"use client";

import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PassportCheck } from "@/src/passport/passport";
import { Spinner, useReducedMotion } from "../bits";
import styles from "./VerifyChecks.module.css";

/**
 * Reveals the checks one at a time so a person can follow what is being proven. The checks
 * themselves have already run (verifyPassport, in this browser); only their display is paced.
 */
export function VerifyChecks({ checks, ok, runKey, stepMs = 420, title = "Checked in this browser" }: { checks: PassportCheck[] | null; ok: boolean | null; runKey: number; stepMs?: number; title?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const total = checks?.length ?? 0;

  useEffect(() => {
    if (!checks) {
      setShown(0);
      return;
    }
    if (reduced) {
      setShown(checks.length);
      return;
    }
    setShown(0);
    let i = 0;
    const t = setInterval(() => {
      i++;
      setShown(i);
      if (i >= checks.length) clearInterval(t);
    }, stepMs);
    return () => clearInterval(t);
  }, [checks, runKey, reduced, stepMs]);

  const done = checks !== null && shown >= total;
  return (
    <div className={styles.wrap}>
      <ol className={styles.list} aria-label={title}>
        {(checks ?? Array.from({ length: 7 }, () => null)).map((c, i) => {
          const state = !c ? "wait" : i < shown ? (c.ok ? "pass" : "fail") : i === shown ? "running" : "wait";
          return (
            <li key={c?.id ?? i} className={styles.item} data-state={state}>
              <span className={styles.icon} aria-hidden>
                {state === "pass" ? <Check /> : state === "fail" ? <X /> : state === "running" ? <Spinner size={14} /> : null}
              </span>
              <span className={styles.text}>
                <span className={styles.label}>{c?.label ?? <span className="skeleton" style={{ display: "inline-block", width: 180, height: 12 }} />}</span>
                {c && i < shown && <span className={styles.detail}>{c.detail}</span>}
              </span>
              {c && i < shown && <span className="visually-hidden">{c.ok ? "passed" : "failed"}</span>}
            </li>
          );
        })}
      </ol>
      <div className={styles.verdict} data-state={!done ? "pending" : ok ? "ok" : "bad"} role="status" aria-live="polite">
        {!done ? (
          <>
            <Spinner size={18} /> <span>Checking…</span>
          </>
        ) : ok ? (
          <>
            <ShieldCheck aria-hidden />
            <span>
              <b>Verified.</b> All {total} checks passed in this browser.
            </span>
          </>
        ) : (
          <>
            <ShieldAlert aria-hidden />
            <span>
              <b>Does not verify.</b> {checks!.filter((c) => !c.ok).length} of {total} checks failed. This record was changed after it was issued, or is not a Licence Passport.
            </span>
          </>
        )}
      </div>
    </div>
  );
}
