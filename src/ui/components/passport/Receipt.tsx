"use client";

import { ArrowLeft, Printer, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Passport } from "@/src/passport/passport";
import { api, ApiError, errorMessage } from "@/src/ui/lib/api";
import { assetLabel, dateText, formatMoney, isSimulatedId, shortHash, termsSummary } from "@/src/ui/lib/format";
import { boughtOn, passportLicenceDates } from "@/src/ui/lib/licence-dates";
import { LogoMark } from "../Logo";
import styles from "./Receipt.module.css";

type Load = { status: "loading" } | { status: "ready"; passport: Passport } | { status: "missing"; message: string };

/**
 * What one creator was paid for one licence, on one printable page: the terms it was bought on, the sentences
 * they came from, the payout, and where to re-check the full Licence Passport. Built only from the passport.
 */
export function Receipt({ id, assetId }: { id: string; assetId: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    api<Passport>(`/api/passports/${encodeURIComponent(id)}`)
      .then((p) => alive && setLoad({ status: "ready", passport: p }))
      .catch((e) => alive && setLoad({ status: "missing", message: e instanceof ApiError && e.status === 409 ? e.message : e instanceof ApiError && e.status === 404 ? "No passport with this address." : errorMessage(e) }));
    return () => {
      alive = false;
    };
  }, [id]);

  if (load.status === "loading") return <div className={`container-wide ${styles.page}`} aria-busy="true"><div className="skeleton" style={{ height: 420, width: "min(720px, 100%)", borderRadius: 6 }} /></div>;
  const offer = load.status === "ready" ? load.passport.bundle.offers.find((o) => o.assetId === assetId) : undefined;
  if (load.status !== "ready" || !offer) {
    return (
      <div className={`container-wide ${styles.page}`}>
        <p className="callout tone-neutral">{load.status === "missing" ? load.message : `This purchase has no licence for "${assetId}".`}</p>
        <Link className="btn" href={`/passport/${encodeURIComponent(id)}`}>
          <ArrowLeft aria-hidden /> Back to the passport
        </Link>
      </div>
    );
  }

  const p = load.passport;
  const doc = p.documents.find((d) => d.id === offer.evidence[0]?.documentId);
  const payout = p.payouts?.lines.find((l) => l.assetId === assetId);
  const licensor = doc?.licensorName ?? payout?.licensor ?? "The licensor";
  const date = passportLicenceDates(p).find((d) => d.assetId === assetId);
  const simulated = isSimulatedId(p.paypal.captureId) || isSimulatedId(p.paypal.orderId);
  const quotes = [...new Set(offer.evidence.map((e) => e.quote))];

  return (
    <div className={`container-wide ${styles.page}`}>
      <article className={styles.paper} aria-labelledby="receipt-title">
        <header className={styles.head}>
          <b style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <LogoMark size={22} /> LicenseGraph · Licence receipt
          </b>
          <span>
            Passport <code>{p.id}</code>
          </span>
        </header>

        <div>
          <h1 id="receipt-title" className={styles.title}>
            {licensor}: {assetLabel(assetId).toLowerCase()} licence
          </h1>
          <p className={styles.lead}>
            Bought for {p.project.name}. Approved by {p.approval.approvedBy} on {dateText(boughtOn(p))}.
          </p>
        </div>

        <dl className={styles.facts}>
          <dt>Price</dt>
          <dd className={styles.amount}>{formatMoney(offer.priceCents, offer.currency)}</dd>
          <dt>Payment to the creator</dt>
          <dd data-testid="receipt-payout">
            {payout ? `${formatMoney(payout.amountCents, p.payouts?.currency ?? offer.currency)}, ${payout.status.toLowerCase()}, through PayPal Payouts${simulated ? " (payment simulator, no money moved)" : " (Sandbox)"}` : "No payout is recorded for this licence."}
          </dd>
          <dt>Terms</dt>
          <dd>{termsSummary(offer.terms)}</dd>
          <dt>Covers the project until</dt>
          <dd>{date?.endsOn ? dateText(date.endsOn) : "No end date: perpetual"}</dd>
        </dl>

        <section aria-labelledby="receipt-quotes">
          <h2 id="receipt-quotes" className={styles.h2}>
            The sentences these terms come from
          </h2>
          <ul className={styles.quotes}>
            {quotes.map((q) => (
              <li key={q}>
                <q>{q}</q>
              </li>
            ))}
          </ul>
        </section>

        <footer className={styles.foot}>
          <span>
            Ledger head <code>{shortHash(p.ledger.head, 20)}</code> · {p.ledger.events.length} hash-chained events
          </span>
          <span>This receipt is a view of the Licence Passport. Re-check the whole record, in your own browser, from the passport page.</span>
        </footer>
      </article>

      <div className={styles.actions}>
        <button type="button" className="btn" onClick={() => window.print()}>
          <Printer aria-hidden /> Print this receipt
        </button>
        <Link className="btn btn-primary" href={`/passport/${encodeURIComponent(id)}`}>
          <ShieldCheck aria-hidden /> Verify the passport
        </Link>
      </div>
    </div>
  );
}
