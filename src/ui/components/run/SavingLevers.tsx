"use client";

import { Mail } from "lucide-react";
import type { SavingLever } from "@/src/core/negotiation";
import { draftLicensorMessage } from "@/src/core/insights";
import type { Project } from "@/src/core/types";
import type { Catalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney, mailtoHref } from "@/src/ui/lib/format";
import { AssetIcon, CopyButton } from "../bits";
import styles from "./Insights.module.css";

/**
 * Where a verified bundle could cost less: a cheaper offer that fails only on terms its licensor could change,
 * with exactly what to ask. A best case at the price already quoted, not an offer; nothing changes until revised
 * terms are checked as a new run.
 */
export function SavingLevers({ levers, project, catalog }: { levers: SavingLever[]; project: Project; catalog: Catalog }) {
  const total = levers.reduce((n, l) => n + l.savingCents, 0);
  const currency = levers[0]!.currency;
  return (
    <div data-testid="saving-levers" className={styles.levers}>
      <p className="small ink-2" style={{ marginBottom: 10 }}>
        If every licensor below agreed, at the prices they already quoted, you would pay <b>{formatMoney(total, currency)} less</b>. A best case, not an offer: ask, then have their revised licence checked before buying.
      </p>
      <ul className={styles.list}>
        {levers.map((l) => {
          const licensor = catalog.offer(l.offerId)?.licensor;
          const message = draftLicensorMessage(project, { assetId: l.assetId, offerId: l.offerId, priceCents: l.priceCents, currency: l.currency, asks: l.asks }, licensor);
          return (
            <li key={l.offerId} className={styles.lever}>
              <span className={styles.name}>
                <AssetIcon assetId={l.assetId} size={14} /> {assetLabel(l.assetId)} · {licensor ?? l.offerId}
              </span>
              <span className={`${styles.extra} num`} data-free="true">
                saves {formatMoney(l.savingCents, l.currency)}
              </span>
              <span className={styles.hint}>
                {formatMoney(l.priceCents, l.currency)} instead of {formatMoney(l.chosenPriceCents, l.currency)}, if they: {l.asks.map((a) => a.ask).join(" ")}
              </span>
              <span className={styles.leverActions}>
                <CopyButton text={`${message.subject}\n\n${message.body}`} label={`Copy message to the ${assetLabel(l.assetId)} licensor about a lower price`} announce="Message copied" className="btn btn-sm">
                  Copy message
                </CopyButton>
                <a className="btn btn-sm" href={mailtoHref(message.subject, message.body)} aria-label={`Open in email, the ${assetLabel(l.assetId)} licensor`}>
                  <Mail aria-hidden /> Open in email
                </a>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
