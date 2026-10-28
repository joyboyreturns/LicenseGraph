"use client";

import { Bot, FileSearch, Lock, UserCheck } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { checkMandate } from "@/src/core/mandate";
import type { Catalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney, termsSummary } from "@/src/ui/lib/format";
import { AssetIcon, Spinner, storageGet, storageSet } from "../bits";
import styles from "./Panels.module.css";

const NAME_KEY = "lg-approver";

export function BundleTable({ view, catalog, onSelectOffer }: { view: SessionView; catalog: Catalog; onSelectOffer?: (id: string) => void }) {
  const bundle = view.bundle;
  if (!bundle) return null;
  return (
    <div className="table-scroll">
      <table className={`table ${styles.bundle}`}>
        <caption className="visually-hidden">The verified licence bundle</caption>
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Licensor and licence</th>
            <th scope="col">Key terms</th>
            <th scope="col" className="right">
              Price
            </th>
          </tr>
        </thead>
        <tbody>
          {bundle.offers.map((o) => {
            const info = catalog.offer(o.id);
            return (
              <tr key={o.id}>
                <td>
                  <span className={styles.asset}>
                    <AssetIcon assetId={o.assetId} size={15} />
                    {assetLabel(o.assetId)}
                  </span>
                </td>
                <td>
                  <div className={styles.licensor}>{info?.licensor}</div>
                  <div className={styles.sub}>{info?.title}</div>
                  {onSelectOffer && (
                    <button type="button" className={styles.evidenceBtn} onClick={() => onSelectOffer(o.id)}>
                      <FileSearch aria-hidden /> Evidence ({o.evidence.length} quotes)
                    </button>
                  )}
                </td>
                <td className={styles.terms}>{termsSummary(o.terms)}</td>
                <td className={`right num ${styles.price}`}>{formatMoney(o.priceCents, o.currency)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className={styles.totalLabel}>
              Total, {bundle.currency}
            </td>
            <td className={`right num ${styles.total}`}>{formatMoney(bundle.totalCents, bundle.currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** What the agent said its person allowed it to spend, checked against the verified total. Informs the approval; never replaces it. */
function MandateNote({ view }: { view: SessionView }) {
  const mandate = view.meta?.mandate;
  const bundle = view.bundle;
  if (!mandate || !bundle) return null;
  const check = checkMandate(mandate, bundle);
  const cap = formatMoney(mandate.maxTotalCents, mandate.currency);
  const text =
    check.status === "within"
      ? `Within the agent's mandate: it was told to spend at most ${cap}, and this bundle costs ${formatMoney(bundle.totalCents, bundle.currency)}.`
      : check.status === "over"
        ? `Over the agent's mandate by ${formatMoney(check.overByCents, bundle.currency)}: it was told to spend at most ${cap}. Only approve if you meant to allow more.`
        : `The agent's mandate (${cap}) is in ${mandate.currency} but this bundle is in ${bundle.currency}, so they cannot be compared.`;
  return (
    <p className={styles.lockNote} role="note" data-tone={check.status === "within" ? undefined : "warn"} data-testid="mandate-note">
      <Bot aria-hidden /> {text}
      {mandate.note ? ` Its instruction: \u201c${mandate.note}\u201d` : ""}
    </p>
  );
}

export function ApprovalPanel({ view, catalog, onApprove, busy, onSelectOffer }: { view: SessionView; catalog: Catalog; onApprove: (name: string) => void; busy: boolean; onSelectOffer: (id: string) => void }) {
  const [name, setName] = useState("");
  const id = useId();
  useEffect(() => {
    const saved = storageGet(NAME_KEY);
    if (saved) setName(saved);
  }, []);
  const bundle = view.bundle;
  if (!bundle) return null;
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    storageSet(NAME_KEY, n);
    onApprove(n);
  };
  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.stepBadge}>
          <UserCheck aria-hidden />
        </span>
        <div>
          <h2 className={styles.h2}>Approve the verified bundle</h2>
          <p className={styles.lead}>The agent proposed it and the rules engine verified it. Review the quoted source terms before signing off: quote checks confirm the text exists, not that the model interpreted it correctly.</p>
        </div>
      </div>
      <BundleTable view={view} catalog={catalog} onSelectOffer={onSelectOffer} />
      <MandateNote view={view} />
      {view.payoutBlockedAssets && (
        <p className={styles.lockNote} role="note" data-tone="warn">
          <Lock aria-hidden /> No payout email for {view.payoutBlockedAssets.map(assetLabel).join(", ")}, so those creators cannot be paid and the payment will not be created. Start a new run with a payout email for each licensor to complete a purchase.
        </p>
      )}
      <form
        className={styles.approveForm}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className={styles.field}>
          <label className="label" htmlFor={id}>
            Approve as
          </label>
          <input id={id} className="input" type="text" autoComplete="name" placeholder="Your name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required aria-describedby={`${id}-help`} />
        </div>
        <button type="submit" className="btn btn-ok btn-lg" disabled={busy || !name.trim()}>
          {busy ? <Spinner label="Approving" /> : <UserCheck aria-hidden />}
          Approve this bundle
        </button>
      </form>
      <p id={`${id}-help`} className={styles.lockNote}>
        <Lock aria-hidden /> Approval locks exactly this bundle: its fingerprint is recorded, and the PayPal order can only be created for these {bundle.offers.length} licences at {formatMoney(bundle.totalCents, bundle.currency)}.
      </p>
    </div>
  );
}
