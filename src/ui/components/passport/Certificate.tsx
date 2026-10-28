"use client";

import type { Passport } from "@/src/passport/passport";
import { buildCatalog } from "@/src/ui/lib/catalog";
import { boughtOn, passportLicenceDates } from "@/src/ui/lib/licence-dates";
import { eventTitle } from "@/src/ui/lib/event-text";
import { assetLabel, dateText, dateTimeText, formatMoney, isSimulatedId, projectRequirements, shortHash, termsSummary } from "@/src/ui/lib/format";
import { LogoMark } from "../Logo";
import { AssetIcon } from "../bits";
import styles from "./Certificate.module.css";

function PayId({ label, value }: { label: string; value: string }) {
  const sim = isSimulatedId(value);
  return (
    <div className={styles.kv}>
      <dt>{label}</dt>
      <dd>
        <code className={styles.code}>{value}</code> <span className={`${styles.env} ${sim ? styles.envSim : ""}`}>{sim ? "SIMULATED" : "SANDBOX"}</span>
      </dd>
    </div>
  );
}

export function Certificate({ passport: p, qrSrc, verifyUrl }: { passport: Passport; qrSrc?: string; verifyUrl?: string }) {
  const catalog = buildCatalog(p.documents, p.bundle.offers);
  const currency = p.bundle.currency;
  const simulated = isSimulatedId(p.paypal.captureId) || isSimulatedId(p.paypal.orderId);
  const reqs = projectRequirements(p.project, currency);
  const dates = passportLicenceDates(p);
  const answers = p.ledger.events.find((e) => e.kind === "answers_run");
  const negotiation = answers ? `${eventTitle(answers)}.` : undefined;
  return (
    <article className={styles.cert} aria-labelledby="cert-title">
      <div className={styles.border} aria-hidden />
      <header className={styles.head}>
        <div className={styles.brand}>
          <LogoMark size={30} />
          <span>LicenseGraph</span>
        </div>
        <div className={styles.headMeta}>
          <span>Passport No.</span>
          <code>{p.id}</code>
        </div>
      </header>

      <div className={styles.titleRow}>
        <div className={styles.titleBlock}>
          <p className={styles.kicker}>Licence Passport</p>
          <h1 id="cert-title" className={styles.title}>
            {p.project.name}
          </h1>
          <p className={styles.statement}>
            {p.bundle.offers.length} {p.bundle.offers.length === 1 ? "licence was" : "licences were"} read, verified against the project&rsquo;s requirements by a deterministic rules engine, approved by a person, and paid for{simulated ? " on a payment simulator" : " on the PayPal Sandbox"}.
          </p>
          <div className={styles.reqs}>
            {reqs.map((r) => (
              <span key={r.key}>
                <b>{r.label}</b> {r.value}
              </span>
            ))}
          </div>
        </div>
        {qrSrc && (
          <div className={styles.qr}>
            <img src={qrSrc} alt={`QR code linking to this passport${verifyUrl ? `: ${verifyUrl}` : ""}`} width={124} height={124} />
            <span>Scan to verify</span>
          </div>
        )}
      </div>

      <section className={styles.section} aria-labelledby="cert-bundle">
        <h2 id="cert-bundle" className={styles.h2}>
          Licensed bundle
        </h2>
        <div className="table-scroll">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Licensor</th>
                <th scope="col">Terms</th>
                <th scope="col" className={styles.right}>
                  Price
                </th>
              </tr>
            </thead>
            <tbody>
              {p.bundle.offers.map((o) => {
                const info = catalog.offer(o.id);
                return (
                  <tr key={o.id}>
                    <td>
                      <span className={styles.asset}>
                        <AssetIcon assetId={o.assetId} size={14} /> {assetLabel(o.assetId)}
                      </span>
                    </td>
                    <td>
                      <div className={styles.strong}>{info?.licensor}</div>
                      <div className={styles.muted}>{info?.title}</div>
                    </td>
                    <td className={styles.terms}>{termsSummary(o.terms)}</td>
                    <td className={`${styles.right} ${styles.price}`}>{formatMoney(o.priceCents, o.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className={styles.totalLabel}>
                  Total paid
                </td>
                <td className={`${styles.right} ${styles.total}`}>{formatMoney(p.bundle.totalCents, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.section} aria-labelledby="cert-approval">
          <h2 id="cert-approval" className={styles.h2}>
            Approval
          </h2>
          <dl className={styles.dl}>
            <div className={styles.kv}>
              <dt>Approved by</dt>
              <dd className={styles.strong}>{p.approval.approvedBy}</dd>
            </div>
            <div className={styles.kv}>
              <dt>Approved at</dt>
              <dd>{dateTimeText(p.approval.approvedAt)}</dd>
            </div>
            <div className={styles.kv}>
              <dt>Bundle fingerprint</dt>
              <dd>
                <code className={styles.code}>{shortHash(p.bundle.digest, 24)}</code>
              </dd>
            </div>
          </dl>
        </section>
        <section className={styles.section} aria-labelledby="cert-payment">
          <h2 id="cert-payment" className={styles.h2}>
            Payment {simulated ? "(simulated, no money moved)" : "(PayPal Sandbox, test money)"}
          </h2>
          <dl className={styles.dl}>
            <PayId label="Order" value={p.paypal.orderId} />
            <PayId label="Capture" value={p.paypal.captureId} />
            <div className={styles.kv}>
              <dt>Captured</dt>
              <dd className={styles.strong}>
                {p.paypal.amount.value} {p.paypal.amount.currency} on {dateTimeText(p.issuedAt)}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {p.payouts && (
        <section className={styles.section} aria-labelledby="cert-payouts">
          <h2 id="cert-payouts" className={styles.h2}>
            Creators paid
          </h2>
          <ul className={styles.payouts}>
            {p.payouts.lines.map((l) => (
              <li key={`${l.assetId}-${l.licensor}`}>
                <span className={styles.strong}>{l.licensor}</span>
                <span className={styles.muted}>{assetLabel(l.assetId)}</span>
                <span className={styles.price}>{formatMoney(l.amountCents, p.payouts!.currency)}</span>
                <span className={`${styles.status} ${l.status === "SUCCESS" ? styles.statusOk : ""}`}>{l.status}</span>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            Batch <code className={styles.code}>{p.payouts.batchId}</code> · {p.payouts.status}
          </p>
        </section>
      )}

      <section className={styles.section} aria-labelledby="cert-compare">
        <h2 id="cert-compare" className={styles.h2}>
          Compliance
        </h2>
        <p className={styles.compare}>
          Buying the cheapest offer for each asset would have cost <b>{formatMoney(p.comparison.naiveTotalCents, currency)}</b>
          {p.comparison.blockedPurchases.length > 0 ? (
            <>
              , including {p.comparison.blockedPurchases.length} {p.comparison.blockedPurchases.length === 1 ? "licence" : "licences"} this project could not use. The verified bundle cost <b>{formatMoney(p.comparison.compliancePremiumCents, currency)}</b> more.
            </>
          ) : (
            <>, and every one of those was compliant.</>
          )}
        </p>
        {p.comparison.blockedPurchases.length > 0 && (
          <ul className={styles.blocked}>
            {p.comparison.blockedPurchases.map((b) => (
              <li key={b.offerId}>
                <b>
                  {assetLabel(b.assetId)}, {formatMoney(b.priceCents, currency)}:
                </b>{" "}
                {b.reasons.join(" ")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="cert-dates">
        <h2 id="cert-dates" className={styles.h2}>
          When each licence ends
        </h2>
        <ul className={styles.blocked}>
          {dates.map((d) => (
            <li key={d.offerId}>
              <b>{d.label}:</b> {d.perpetual ? "perpetual, no end date" : d.endsOn ? `covered until ${dateText(d.endsOn)}` : "end date not stated"}
            </li>
          ))}
        </ul>
        <p className={styles.compare}>Counted from the day of purchase, {dateText(boughtOn(p))}, using each licence&rsquo;s own term.</p>
      </section>

      {negotiation && (
        <section className={styles.section} aria-labelledby="cert-negotiation">
          <h2 id="cert-negotiation" className={styles.h2}>
            Negotiation
          </h2>
          <p className={styles.compare}>
            This purchase followed a negotiation. {negotiation} The earlier run is recorded in the first entry of this passport&rsquo;s ledger, so it cannot be removed without breaking the hash chain.
          </p>
        </section>
      )}

      <footer className={styles.foot}>
        <span>
          Ledger head <code className={styles.code}>{shortHash(p.ledger.head, 20)}</code> · {p.ledger.events.length} hash-chained events
        </span>
        <span>{verifyUrl ? `Re-verify at ${verifyUrl}` : "Re-verify this file at /verify on any LicenseGraph server"}</span>
      </footer>
    </article>
  );
}
