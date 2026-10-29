"use client";

import { Bot, FileSearch, Lock, UserCheck } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { checkMandate, mandateBreaches } from "@/src/core/mandate";
import { finePrint } from "@/src/core/fine-print";
import type { Catalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney, termsSummary } from "@/src/ui/lib/format";
import { AssetIcon, Spinner, storageGet, storageSet } from "../bits";
import styles from "./Panels.module.css";

const NAME_KEY = "lg-approver";

export function BundleTable({ view, catalog, onSelectOffer }: { view: SessionView; catalog: Catalog; onSelectOffer?: (id: string) => void }) {
  const bundle = view.bundle;
  if (!bundle) return null;
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="The verified licence bundle">
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

/** Who receives what once the payment is captured, so the buyer approves knowing where the money goes. Same plan the payout uses. */
function PayoutPreview({ view }: { view: SessionView }) {
  const lines = view.payoutPreview;
  if (!lines?.length) return null;
  return (
    <div className={styles.finePrint} data-testid="payout-preview">
      <h3 className={styles.finePrintTitle}>Creators are paid after the payment is captured</h3>
      <ul>
        {lines.map((l) => (
          <li key={`${l.assetId}-${l.emailMasked}`}>
            <b>{l.licensorName}</b> · {assetLabel(l.assetId)}: {formatMoney(l.amountCents, l.currency)} to <code>{l.emailMasked}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Clauses the rules engine does not check, quoted from the bought licences, so "verified" is not read as "nothing else to read". */
function FinePrint({ view, catalog }: { view: SessionView; catalog: Catalog }) {
  const rows = (view.bundle?.offers ?? []).flatMap((o) => {
    const info = catalog.offer(o.id);
    const doc = info?.documentId ? catalog.docs.get(info.documentId) : undefined;
    return doc ? finePrint(doc.text).map((f) => ({ ...f, licensor: info!.licensor, key: `${o.id}-${f.sentence}` })) : [];
  });
  if (!rows.length) return null;
  return (
    <div className={styles.finePrint} data-testid="fine-print">
      <h3 className={styles.finePrintTitle}>Also in these licences, not checked by the rules engine</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.key}>
            <b>{r.licensor}</b> · {r.label}: <q>{r.sentence}</q>
          </li>
        ))}
      </ul>
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
  const licensorOf = new Map(view.documents.map((d) => [d.id, d.licensorName]));
  const breaches = mandateBreaches(mandate, bundle.offers.map((o) => ({ assetId: o.assetId, priceCents: o.priceCents, currency: o.currency, licensor: licensorOf.get(o.evidence[0]?.documentId ?? "") })));
  return (
    <div className={styles.lockNote} role="note" data-tone={check.status === "within" && !breaches.length ? undefined : "warn"} data-testid="mandate-note">
      <div>
        <p style={{ margin: 0 }}>
          <Bot aria-hidden /> {text}
          {mandate.note ? ` Its instruction: \u201c${mandate.note}\u201d` : ""}
        </p>
        {breaches.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }} data-testid="mandate-breaches">
            {breaches.map((b) => (
              <li key={`${b.kind}-${b.assetId}`}>{b.detail}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
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
      <PayoutPreview view={view} />
      <FinePrint view={view} catalog={catalog} />
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
