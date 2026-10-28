"use client";

import { Ban, ShieldCheck } from "lucide-react";
import type { RunAnalysis } from "@/src/core/analysis";
import type { Catalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney, pluralise } from "@/src/ui/lib/format";
import { AssetIcon } from "../bits";
import styles from "./ComplianceSummary.module.css";

/**
 * The honest comparison: what shopping on price alone would have cost, which of those licences the
 * project could not have used and why, and what the verified bundle costs. Every figure is a price
 * read from an uploaded licence.
 */
export function ComplianceSummary({ analysis, catalog, currency, verified }: { analysis: RunAnalysis; catalog: Catalog; currency: string; verified: boolean }) {
  const blocked = analysis.blockedPurchases;
  const max = Math.max(1, ...analysis.assets.flatMap((a) => [a.cheapestCents, a.chosenCents ?? 0]));
  const m = (c: number) => formatMoney(c, currency);
  return (
    <div className={styles.wrap}>
      <div className={styles.compare}>
        <div className={styles.side} data-kind="naive">
          <span className={styles.label}>
            <Ban aria-hidden /> Price-only buyer
          </span>
          <span className={`${styles.amount} num`}>{m(analysis.naiveTotalCents)}</span>
          <span className={styles.note}>{blocked.length ? <>Includes {pluralise(blocked.length, "licence")} this project could not use.</> : <>The cheapest offer for every asset was also compliant.</>}</span>
        </div>
        <div className={styles.side} data-kind={verified ? "verified" : "none"}>
          <span className={styles.label}>
            <ShieldCheck aria-hidden /> {verified ? "Verified bundle" : "No verified bundle"}
          </span>
          <span className={`${styles.amount} num`}>{verified ? m(analysis.chosenTotalCents) : "—"}</span>
          <span className={styles.note}>{verified ? (analysis.compliancePremiumCents > 0 ? <>Compliance premium {m(analysis.compliancePremiumCents)}: what staying within the licences costs.</> : <>No premium: the cheapest offers were compliant.</>) : <>The rules engine accepted no bundle.</>}</span>
        </div>
      </div>

      {analysis.optimization && (
        <div className={styles.blocked}>
          <h3 className={styles.h3}>Independent cost check</h3>
          <p className={styles.note}>Code checks the cheapest compliant choice for each asset in each currency, covering {analysis.optimization.candidateCombinations} possible bundles from the uploaded offers. No rights requirement is relaxed.</p>
          {analysis.optimization.plans.map((plan) => (
            <p className={styles.reasons} key={plan.currency}>
              <b>Minimum compliant cost: {formatMoney(plan.totalCents, plan.currency)}.</b>{" "}
              {plan.budgetShortfallCents > 0
                ? <>The budget needs {formatMoney(plan.budgetShortfallCents, plan.currency)} more. Approval and payment stay blocked.</>
                : verified && plan.currency === currency
                  ? analysis.chosenTotalCents === plan.totalCents
                    ? <>The agent found the cheapest compliant bundle. Optimality checked independently.</>
                    : <>A compliant alternative costs {formatMoney(plan.totalCents, plan.currency)}. Review the offer matrix before approving.</>
                  : <>A compliant bundle exists within the budget; the agent has not secured approval for it.</>}
            </p>
          ))}
          {!analysis.optimization.plans.length && <p className={styles.reasons}>{analysis.optimization.uncoveredAssets.length ? <>No compliant offer for: {analysis.optimization.uncoveredAssets.map(assetLabel).join(", ")}. Add or renegotiate those licences.</> : <>No complete bundle shares one currency. Obtain offers in a common currency.</>}</p>}
        </div>
      )}

      {blocked.length > 0 && (
        <div className={styles.blocked}>
          <h3 className={styles.h3}>What a price-only buyer would have bought and could not use</h3>
          <ul>
            {blocked.map((b) => (
              <li key={b.offerId}>
                <span className={styles.bTop}>
                  <span className={styles.bName}>{catalog.offerName(b.offerId)}</span>
                </span>
                <span className={styles.reasons}>{b.reasons.join(" ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.bars}>
        <h3 className={styles.h3}>Per asset: cheapest offer vs verified choice</h3>
        <ul>
          {analysis.assets.map((a) => (
            <li key={a.assetId}>
              <span className={styles.barLabel}>
                <AssetIcon assetId={a.assetId} size={14} />
                {assetLabel(a.assetId)}
              </span>
              <span className={styles.barRows}>
                <span className={styles.barRow}>
                  <span className={styles.track} aria-hidden>
                    <span className={styles.bar} data-kind={a.cheapestIsBlocked ? "blocked" : "cheap"} style={{ width: `${(a.cheapestCents / max) * 100}%` }} />
                  </span>
                  <span className={`${styles.barValue} num`}>
                    {formatMoney(a.cheapestCents, currency, { trim: true })}
                    <span className="visually-hidden"> cheapest{a.cheapestIsBlocked ? ", blocked" : ""}</span>
                  </span>
                </span>
                <span className={styles.barRow}>
                  <span className={styles.track} aria-hidden>
                    <span className={styles.bar} data-kind="chosen" style={{ width: `${((a.chosenCents ?? 0) / max) * 100}%` }} />
                  </span>
                  <span className={`${styles.barValue} num`}>
                    {a.chosenCents !== undefined ? formatMoney(a.chosenCents, currency, { trim: true }) : "—"}
                    <span className="visually-hidden"> verified choice</span>
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className={styles.key} aria-hidden>
          <span>
            <i data-kind="blocked" /> Cheapest, blocked by a rule
          </span>
          <span>
            <i data-kind="cheap" /> Cheapest, compliant
          </span>
          <span>
            <i data-kind="chosen" /> Verified choice
          </span>
        </div>
      </div>
    </div>
  );
}
