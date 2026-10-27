"use client";

import { Check, Minus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunAnalysis } from "@/src/core/analysis";
import { RULE_CATALOG } from "@/src/core/rules";
import type { Catalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney } from "@/src/ui/lib/format";
import type { RunState } from "@/src/ui/lib/replay";
import { ruleChecks, violationText } from "@/src/ui/lib/rule-text";
import { AssetIcon } from "../bits";
import styles from "./VerificationMatrix.module.css";

interface Props {
  analysis: RunAnalysis;
  requiredAssetIds: readonly string[];
  catalog: Catalog;
  state: RunState;
  currency: string;
  selectedOfferId?: string;
  onSelectOffer: (id: string) => void;
}

interface Tip {
  key: string;
  title: string;
  body: string[];
  x: number;
  y: number;
  below: boolean;
}

export function VerificationMatrix({ analysis, requiredAssetIds, catalog, state, currency, selectedOfferId, onSelectOffer }: Props) {
  const groups = useMemo(() => {
    const order = [...requiredAssetIds, ...analysis.evaluations.map((e) => e.assetId).filter((a) => !requiredAssetIds.includes(a))];
    return [...new Set(order)].map((assetId) => ({ assetId, rows: analysis.evaluations.filter((e) => e.assetId === assetId).sort((a, b) => a.priceCents - b.priceCents || a.offerId.localeCompare(b.offerId)) })).filter((g) => g.rows.length);
  }, [analysis, requiredAssetIds]);

  const unused = useMemo(() => new Set(RULE_CATALOG.filter((r) => analysis.evaluations.every((e) => e.results.find((x) => x.rule === r.id)?.status === "skip")).map((r) => r.id)), [analysis]);
  const [tip, setTip] = useState<Tip | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const show = useCallback((el: HTMLElement, key: string, title: string, body: string[]) => {
    const r = el.getBoundingClientRect();
    const below = r.top < 200;
    setTip({ key, title, body, x: Math.min(Math.max(12, r.left + r.width / 2), window.innerWidth - 12), y: below ? r.bottom + 8 : r.top - 8, below });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    const el = scrollRef.current;
    el?.addEventListener("scroll", close, { passive: true });
    window.addEventListener("scroll", close, { passive: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener("scroll", close);
      window.removeEventListener("scroll", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [tip]);

  const cols = RULE_CATALOG.length + 3;
  const failedTotal = analysis.evaluations.filter((e) => !e.compliant).length;

  return (
    <div className={styles.wrap}>
      <div className={styles.legend}>
        <span>
          <span className={`${styles.icon} ${styles.pass}`}>
            <Check aria-hidden />
          </span>
          Pass
        </span>
        <span>
          <span className={`${styles.icon} ${styles.fail}`}>
            <X aria-hidden />
          </span>
          Fail (hover, focus or tap for the reason)
        </span>
        <span>
          <span className={`${styles.icon} ${styles.skip}`}>
            <Minus aria-hidden />
          </span>
          Not required by this project
        </span>
        <span>
          <span className={styles.chosenSwatch} aria-hidden />
          In the verified bundle
        </span>
        <span className={styles.legendNote}>
          {analysis.evaluations.length} licences × {RULE_CATALOG.length} rules, each licence checked on its own. {failedTotal} fail at least one rule.
        </span>
      </div>
      <div ref={scrollRef} className={styles.scroll} tabIndex={0} role="region" aria-label="Verification matrix: every candidate licence against every rule">
        <table className={styles.table}>
          <caption className="visually-hidden">Every candidate licence checked against every rule. Rows are grouped by asset; the chosen licence for each asset is marked.</caption>
          <thead>
            <tr>
              <th scope="col" className={`${styles.sticky} ${styles.colLicence}`}>
                Licence
              </th>
              <th scope="col" className={styles.right}>
                Price
              </th>
              {RULE_CATALOG.map((r) => (
                <th key={r.id} scope="col" className={styles.ruleCol} data-unused={unused.has(r.id) || undefined} title={ruleChecks(r.id)}>
                  <span>{r.label}</span>
                </th>
              ))}
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.assetId}>
              <tr className={styles.groupRow}>
                <th scope="rowgroup" colSpan={cols} className={styles.groupHead}>
                  <span className={styles.groupInner}>
                    <AssetIcon assetId={g.assetId} size={14} />
                    {assetLabel(g.assetId)}
                    <span className={styles.groupCount}>
                      {g.rows.length} {g.rows.length === 1 ? "offer" : "offers"}
                    </span>
                  </span>
                </th>
              </tr>
              {g.rows.map((row) => {
                const info = catalog.offer(row.offerId);
                const s = state.offers[row.offerId] ?? "hidden";
                const revealed = s !== "hidden";
                const fails = row.results.filter((r) => r.status === "fail");
                return (
                  <tr key={row.offerId} className={styles.row} data-state={s} data-chosen={row.chosen || undefined} data-selected={selectedOfferId === row.offerId || undefined}>
                    <th scope="row" className={`${styles.sticky} ${styles.licence}`}>
                      <button type="button" className={styles.licenceBtn} onClick={() => onSelectOffer(row.offerId)} aria-label={`${info?.name ?? row.offerId}: open evidence`}>
                        <span className={styles.licensor}>{info?.licensor ?? row.offerId}</span>
                        <span className={styles.title}>{info?.title}</span>
                      </button>
                    </th>
                    <td className={`${styles.right} ${styles.price} num`}>{formatMoney(row.priceCents, currency, { trim: true })}</td>
                    {row.results.map((r) => {
                      if (!revealed) {
                        return (
                          <td key={r.rule} className={styles.cell}>
                            <span className={styles.pending} aria-label="Not read yet">
                              ·
                            </span>
                          </td>
                        );
                      }
                      if (r.status === "pass")
                        return (
                          <td key={r.rule} className={styles.cell}>
                            <span className={`${styles.icon} ${styles.pass}`} role="img" aria-label={`${r.label}: pass`}>
                              <Check aria-hidden />
                            </span>
                          </td>
                        );
                      if (r.status === "skip")
                        return (
                          <td key={r.rule} className={styles.cell}>
                            <span className={`${styles.icon} ${styles.skip}`} role="img" aria-label={`${r.label}: not required by this project`}>
                              <Minus aria-hidden />
                            </span>
                          </td>
                        );
                      const key = `${row.offerId}:${r.rule}`;
                      const body = r.messages.map((m) => violationText({ rule: r.rule, message: m }, currency));
                      return (
                        <td key={r.rule} className={styles.cell}>
                          <button
                            type="button"
                            className={`${styles.icon} ${styles.fail} ${styles.failBtn}`}
                            aria-label={`${r.label}: fail. ${body.join(" ")}`}
                            aria-expanded={tip?.key === key}
                            onMouseEnter={(e) => show(e.currentTarget, key, `${r.label} · ${info?.licensor ?? ""}`, body)}
                            onMouseLeave={hide}
                            onFocus={(e) => show(e.currentTarget, key, `${r.label} · ${info?.licensor ?? ""}`, body)}
                            onBlur={hide}
                            onClick={(e) => (tip?.key === key ? hide() : show(e.currentTarget, key, `${r.label} · ${info?.licensor ?? ""}`, body))}
                          >
                            <X aria-hidden />
                          </button>
                        </td>
                      );
                    })}
                    <td className={styles.verdictCell}>
                      {!revealed ? (
                        <span className={styles.pendingText}>Not read yet</span>
                      ) : row.chosen ? (
                        <span className="chip chip-sm tone-ok">
                          <Check aria-hidden /> Chosen
                        </span>
                      ) : row.compliant ? (
                        <span className="chip chip-sm tone-neutral">Compliant</span>
                      ) : (
                        <span className="chip chip-sm tone-bad">
                          Blocked · {fails.length} {fails.length === 1 ? "rule" : "rules"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {tip && (
        <div className={`${styles.tip} ${tip.below ? styles.tipBelow : ""}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
          <strong>{tip.title}</strong>
          {tip.body.map((b, i) => (
            <span key={i}>{b}</span>
          ))}
        </div>
      )}
    </div>
  );
}
