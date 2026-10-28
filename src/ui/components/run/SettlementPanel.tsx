"use client";

import { ArrowRight, BadgeCheck, Check, CreditCard, ExternalLink, FileBadge, FlaskConical, Hand, RotateCw, Send, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionView } from "@/src/app-logic/session";
import type { AppConfig } from "@/src/ui/lib/api";
import { assetLabel, dateTimeText, formatMoney, isPayoutFinal, isSimulatedId, payoutTone, shortHash } from "@/src/ui/lib/format";
import { CopyButton, Spinner } from "../bits";
import styles from "./Panels.module.css";

type StepState = "todo" | "current" | "done" | "failed";

function Step({ n, state, icon, title, children }: { n: number; state: StepState; icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <li className={styles.sStep} data-state={state} aria-current={state === "current" ? "step" : undefined}>
      <span className={styles.sMarker} aria-hidden>
        {state === "done" ? <Check /> : icon}
      </span>
      <div className={styles.sBody}>
        <h3 className={styles.sTitle}>
          <span className={styles.sNum}>{n}</span> {title}
          <span className="visually-hidden">, {state === "done" ? "complete" : state === "current" ? "in progress" : state === "failed" ? "needs attention" : "waiting"}</span>
        </h3>
        {children}
      </div>
    </li>
  );
}

function Id({ label, value }: { label: string; value: string }) {
  const simulated = isSimulatedId(value);
  return (
    <span className={styles.idRow}>
      <span className={styles.idLabel}>{label}</span>
      <code className={styles.id}>{value}</code>
      <span className={`chip chip-sm ${simulated ? "tone-neutral" : "tone-engine"}`}>{simulated ? "Simulated" : "Sandbox"}</span>
      <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} className="btn btn-ghost btn-sm btn-icon" announce={`${label} copied`} />
    </span>
  );
}

export interface SettlementActions {
  pay: () => void;
  capture: () => void;
  retryPayouts: () => void;
}

export function SettlementPanel({ view, config, busy, actions }: { view: SessionView; config: AppConfig | null; busy: string | null; actions: SettlementActions }) {
  const simulated = config?.paymentsMode === "simulator" || isSimulatedId(view.order?.id);
  const rail = simulated ? "payment simulator" : "PayPal Sandbox";
  const total = view.bundle ? formatMoney(view.bundle.totalCents, view.bundle.currency) : "";
  const phase = view.phase;
  const payouts = view.payouts;
  const payoutsFailed = payouts?.status === "FAILED";
  const payoutsDone = Boolean(payouts && payouts.status !== "FAILED" && isPayoutFinal(payouts.status));
  const allPaid = payoutsDone && payouts?.status === "SUCCESS" && payouts.lines.every((l) => l.status === "SUCCESS") && payouts.totalCents === view.bundle?.totalCents;
  const captured = Boolean(view.capture);

  const s1: StepState = view.order ? "done" : phase === "approved" ? "current" : "todo";
  const s2: StepState = captured ? "done" : phase === "order_created" ? "current" : "todo";
  const s3: StepState = captured ? "done" : "todo";
  const s4: StepState = !captured ? "todo" : payoutsFailed ? "failed" : payoutsDone ? (allPaid ? "done" : "failed") : "current";
  const s5: StepState = captured ? (allPaid || !payouts ? "done" : "current") : "todo";

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <span className={styles.stepBadge} data-tone="pay">
          <Wallet aria-hidden />
        </span>
        <div>
          <h2 className={styles.h2}>Settle and pay the creators</h2>
          <p className={styles.lead}>
            {simulated ? (
              <>
                <FlaskConical aria-hidden className={styles.inline} /> This server uses the LicenseGraph payment simulator. No money moves.
              </>
            ) : (
              <>PayPal Sandbox: test buyer and test money. No real payment is made.</>
            )}
          </p>
        </div>
      </div>

      {view.approval && (
        <p className={styles.approvedLine}>
          <BadgeCheck aria-hidden /> Approved by <b>{view.approval.approvedBy}</b> on {dateTimeText(view.approval.approvedAt)}. Bundle fingerprint <code className="mono">{shortHash(view.approval.bundleDigest, 12)}</code>
        </p>
      )}

      {allPaid && (
        <div className={styles.celebrate} role="status">
          <span className={styles.seal} aria-hidden>
            <BadgeCheck />
          </span>
          <div>
            <p className={styles.celebrateTitle}>Settled. Every creator has been paid.</p>
            <p className={styles.celebrateText}>
              {payouts!.lines.length} {payouts!.lines.length === 1 ? "licensor" : "licensors"} received {formatMoney(payouts!.totalCents, payouts!.currency)} in total{simulated ? " (simulated)" : " in the Sandbox"}. The Licence Passport is ready to share.
            </p>
          </div>
          <Link prefetch={false} href={`/passport/${view.id}`} className="btn btn-ok btn-lg">
            <FileBadge aria-hidden /> View Licence Passport
          </Link>
        </div>
      )}

      <ol className={styles.steps}>
        <Step n={1} state={s1} icon={<CreditCard />} title={simulated ? "Create the order" : "Create the PayPal order"}>
          {s1 === "current" && (
            <>
              <p className={styles.sText}>The server re-verifies the bundle and checks your approval matches it before creating the order.</p>
              {config && !config.paymentsEnabled ? (
                <p className="callout tone-warn">Payments are not configured on this server, so no order can be created. The run is verified and approved.</p>
              ) : (
                <button type="button" className="btn btn-primary" onClick={actions.pay} disabled={busy !== null}>
                  {busy === "pay" ? <Spinner label="Creating order" /> : <CreditCard aria-hidden />}
                  Create {simulated ? "simulated" : "PayPal Sandbox"} order for {total}
                </button>
              )}
            </>
          )}
          {view.order && <Id label="Order ID" value={view.order.id} />}
        </Step>

        <Step n={2} state={s2} icon={<Hand />} title={simulated ? "Buyer approves in the simulator" : "Buyer approves at PayPal"}>
          {s2 === "current" && view.order && (
            <>
              <p className={styles.sText}>Open the checkout and approve as the buyer. You will come straight back here and the payment is captured.</p>
              <div className="row">
                <a href={view.order.approveUrl} className="btn btn-primary">
                  {simulated ? <FlaskConical aria-hidden /> : <ExternalLink aria-hidden />}
                  {simulated ? "Open payment simulator" : "Open PayPal Sandbox checkout"}
                </a>
                <button type="button" className="btn" onClick={actions.capture} disabled={busy !== null}>
                  {busy === "capture" ? <Spinner label="Completing payment" /> : <ArrowRight aria-hidden />}
                  I&rsquo;ve approved it, complete payment
                </button>
              </div>
            </>
          )}
          {s2 === "done" && <p className={styles.sDone}>The buyer approved the order {simulated ? "in the simulator" : "at PayPal"}.</p>}
        </Step>

        <Step n={3} state={s3} icon={<Wallet />} title="Payment captured">
          {view.capture && (
            <>
              <p className={styles.sDone}>
                <b className="num">
                  {view.capture.amount.value} {view.capture.amount.currency}
                </b>{" "}
                captured, exactly the approved total.
              </p>
              <Id label="Capture ID" value={view.capture.captureId} />
            </>
          )}
        </Step>

        <Step n={4} state={s4} icon={<Send />} title="Creators paid">
          {captured && !payouts && <p className={styles.sText}>{config?.paymentsEnabled ? "Sending payouts…" : "No payout rail is configured on this server."}</p>}
          {payouts && (
            <>
              <p className={styles.sText}>
                One {simulated ? "simulated" : "PayPal Payouts"} batch, one line per licensor. Batch <code className="mono">{payouts.batchId}</code>{" "}
                <span className={`chip chip-sm tone-${payoutTone(payouts.status)}`}>
                  {!isPayoutFinal(payouts.status) && <Spinner size={11} />}
                  {payouts.status}
                </span>
              </p>
              <div className="table-scroll">
                <table className={`table ${styles.payouts}`}>
                  <caption className="visually-hidden">Creator payouts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Licensor</th>
                      <th scope="col">For</th>
                      <th scope="col">Paid to</th>
                      <th scope="col" className="right">
                        Amount
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.lines.map((l) => (
                      <tr key={l.offerId}>
                        <td className={styles.licensor}>{l.licensorName}</td>
                        <td>{assetLabel(l.assetId)}</td>
                        <td>
                          <code className="mono">{l.emailMasked}</code>
                        </td>
                        <td className="right num">{formatMoney(l.amountCents, l.currency)}</td>
                        <td>
                          <span className={`chip chip-sm tone-${payoutTone(l.status)}`}>
                            {!isPayoutFinal(l.status) && l.status !== "UNCLAIMED" && <Spinner size={11} />}
                            {l.status}
                          </span>
                          {l.error && <div className={styles.lineError}>{l.error}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {payoutsFailed && (
                <div className="callout tone-bad" role="alert">
                  <div>
                    <p>
                      <b>The payouts could not be sent.</b> {payouts.error}
                    </p>
                    <p className="small muted" style={{ marginTop: 4 }}>
                      The buyer&rsquo;s payment stays captured; only the transfer to creators needs another try.
                    </p>
                    <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={actions.retryPayouts} disabled={busy !== null}>
                      {busy === "payouts" ? <Spinner label="Retrying" /> : <RotateCw aria-hidden />} Retry payouts
                    </button>
                  </div>
                </div>
              )}
              {payoutsDone && !allPaid && (
                <p className="callout tone-warn" role="status">Some creators have not received their payment. Review each line above and reconcile the batch with PayPal. Sending the entire batch again could pay successful recipients twice.</p>
              )}
            </>
          )}
        </Step>

        <Step n={5} state={s5} icon={<FileBadge />} title="Licence Passport issued">
          {captured && (
            <div className="row">
              <p className={styles.sText} style={{ flex: "1 1 260px" }}>
                A shareable, printable record that anyone can re-verify in their own browser.
              </p>
              {!allPaid && (
                <Link prefetch={false} href={`/passport/${view.id}`} className="btn">
                  <FileBadge aria-hidden /> View passport
                </Link>
              )}
            </div>
          )}
        </Step>
      </ol>
    </div>
  );
}
