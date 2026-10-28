"use client";

import { Mail, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { scenarioById } from "@/src/demo/scenarios";
import { draftLicensorMessage } from "@/src/core/insights";
import { negotiationOutlook } from "@/src/core/negotiation";
import type { Catalog } from "@/src/ui/lib/catalog";
import { api, errorMessage } from "@/src/ui/lib/api";
import { assetLabel, formatMoney, mailtoHref } from "@/src/ui/lib/format";
import { AssetIcon, CopyButton, Spinner } from "../bits";
import { useConfig } from "../Providers";
import styles from "./Insights.module.css";

/**
 * When no bundle can be bought, the way forward: for each blocked asset, the closest licence, the
 * exact terms to ask the licensor to change, and a message that says so, ready to copy.
 */
export function GapRequests({ view, catalog }: { view: SessionView; catalog: Catalog }) {
  const router = useRouter();
  const { config } = useConfig();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState<Record<string, string>>({});
  const canSimulate = Boolean(scenarioById(view.meta?.scenarioId ?? "")?.replies?.length) && !view.meta?.revisedFrom;
  const canPaste = config?.mode === "live";
  const gaps = view.analysis?.gaps ?? [];

  // The answer is checked as a new run; this one stays as it was, on record.
  const revise = async (key: string, json: object) => {
    setBusy(key);
    setError(null);
    try {
      const next = await api<SessionView>(`/api/sessions/${view.id}/revise`, { method: "POST", json });
      router.push(`/run/${next.id}`);
    } catch (e) {
      setError(errorMessage(e, "The revised licence could not be checked."));
      setBusy(null);
    }
  };
  const currency = view.candidates[0]?.currency ?? "USD";
  const outlook = useMemo(
    () => (gaps.length ? negotiationOutlook(view.project, view.analysis?.assets.map((a) => a.assetId) ?? [], view.candidates, currency, { today: view.runDate }) : undefined),
    [gaps.length, view.project, view.analysis, view.candidates, currency, view.runDate],
  );
  if (!gaps.length) return null;
  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        Close the gap: what to ask each licensor
      </p>
      <p className="small ink-2" style={{ marginBottom: 10 }}>
        No offer for these assets passes the rules. This is the closest one for each, and the changes that would make it work. Revised terms are checked again before anything is bought.
      </p>
      {outlook && (
        <div className={styles.outlook} data-testid="negotiation-outlook">
          <span className="eyebrow">If every licensor said yes, at the prices they quoted</span>
          <span className={`${styles.outlookTotal} num`}>{formatMoney(outlook.totalCents, currency)}</span>
          <span className="small ink-2">
            {outlook.headroomCents === undefined
              ? "The cheapest bundle that would then pass every rule. A best case, not an offer: nothing is bought until revised terms are checked."
              : outlook.headroomCents >= 0
                ? `The cheapest bundle that would then pass every rule, ${formatMoney(outlook.headroomCents, currency)} under your budget. A best case, not an offer: nothing is bought until revised terms are checked.`
                : `Even then it is ${formatMoney(-outlook.headroomCents, currency)} over your budget, so a yes alone would not be enough.`}
          </span>
          {outlook.assets.some((a) => a.ceilingCents !== undefined) && (
            <ul className={styles.ceilings}>
              {outlook.assets
                .filter((a) => a.ceilingCents !== undefined)
                .map((a) => (
                  <li key={a.assetId}>
                    <b>{assetLabel(a.assetId)}:</b> {a.ceilingCents! >= a.priceCents ? `worth agreeing up to ${formatMoney(a.ceilingCents!, currency)} (quoted ${formatMoney(a.priceCents, currency)}); above that the budget breaks.` : `the quoted ${formatMoney(a.priceCents, currency)} already breaks the budget; it would have to fall to ${formatMoney(Math.max(0, a.ceilingCents!), currency)}.`}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {canSimulate && (
        <div className={styles.simulate}>
          <p className="small ink-2" style={{ margin: 0 }}>
            Demo: see what happens if the licensors do say yes. They send back exclusive versions of these licences at higher prices, and everything is checked again as a new run.
          </p>
          <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => revise("simulate", { simulate: true })}>
            {busy === "simulate" ? <Spinner label="Checking" /> : <Send aria-hidden />} Simulate the licensors agreeing
          </button>
        </div>
      )}
      {error && (
        <p className="callout tone-bad" role="alert">
          {error}
        </p>
      )}
      <div className={styles.gaps}>
        {gaps.map((gap) => {
          const message = draftLicensorMessage(view.project, gap, catalog.offer(gap.offerId)?.licensor);
          const text = `Subject: ${message.subject}\n\n${message.body}`;
          return (
            <div key={gap.offerId} className={styles.gap}>
              <div className={styles.gapHead}>
                <b>
                  <AssetIcon assetId={gap.assetId} size={14} /> {assetLabel(gap.assetId)} · {catalog.offerName(gap.offerId)}
                </b>
                <span className="small muted">{formatMoney(gap.priceCents, gap.currency)} · closest offer</span>
              </div>
              <ul className={styles.asks}>
                {gap.asks.map((a) => (
                  <li key={a.rule}>{a.ask}</li>
                ))}
              </ul>
              <pre className={styles.draft} tabIndex={0} aria-label="Message to the licensor">{text}</pre>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <CopyButton text={text} label={`Copy message to the ${assetLabel(gap.assetId)} licensor`} announce="Message copied" className="btn btn-sm">
                  Copy message
                </CopyButton>
                <a className="btn btn-sm" href={mailtoHref(message.subject, message.body)}>
                  <Mail aria-hidden /> Open in email
                </a>
              </div>
              {canPaste && (
                <details className={styles.reply}>
                  <summary>They replied: check their revised licence</summary>
                  <label className="small muted" htmlFor={`reply-${gap.assetId}`}>
                    Paste the revised licence text. It is read and checked again as a new run; nothing is bought.
                  </label>
                  <textarea id={`reply-${gap.assetId}`} className="textarea" rows={5} maxLength={20000} value={pasted[gap.assetId] ?? ""} onChange={(e) => setPasted((p) => ({ ...p, [gap.assetId]: e.target.value }))} />
                  <div>
                    <button type="button" className="btn btn-sm" disabled={busy !== null || !(pasted[gap.assetId] ?? "").trim()} onClick={() => revise(gap.assetId, { assetId: gap.assetId, text: pasted[gap.assetId], licensor: { name: catalog.offer(gap.offerId)?.licensor ?? "Licensor" } })}>
                      {busy === gap.assetId ? <Spinner label="Checking" /> : <Send aria-hidden />} Check revised terms
                    </button>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
