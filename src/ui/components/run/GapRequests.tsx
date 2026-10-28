"use client";

import { Mail } from "lucide-react";
import type { SessionView } from "@/src/app-logic/session";
import { draftLicensorMessage } from "@/src/core/insights";
import type { Catalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney, mailtoHref } from "@/src/ui/lib/format";
import { AssetIcon, CopyButton } from "../bits";
import styles from "./Insights.module.css";

/**
 * When no bundle can be bought, the way forward: for each blocked asset, the closest licence, the
 * exact terms to ask the licensor to change, and a message that says so, ready to copy.
 */
export function GapRequests({ view, catalog }: { view: SessionView; catalog: Catalog }) {
  const gaps = view.analysis?.gaps ?? [];
  if (!gaps.length) return null;
  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 8 }}>
        Close the gap: what to ask each licensor
      </p>
      <p className="small ink-2" style={{ marginBottom: 10 }}>
        No offer for these assets passes the rules. This is the closest one for each, and the changes that would make it work. Revised terms are checked again before anything is bought.
      </p>
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
              <pre className={styles.draft}>{text}</pre>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <CopyButton text={text} label={`Copy the message to the ${assetLabel(gap.assetId)} licensor`} announce="Message copied" className="btn btn-sm">
                  Copy message
                </CopyButton>
                <a className="btn btn-sm" href={mailtoHref(message.subject, message.body)}>
                  <Mail aria-hidden /> Open in email
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
