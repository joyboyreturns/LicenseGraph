"use client";

import { ArrowRight, FileText } from "lucide-react";
import { assetLabel, projectRequirements } from "@/src/ui/lib/format";
import { ruleName } from "@/src/ui/lib/rule-text";
import { AssetIcon, Spinner } from "../bits";
import type { ScenarioInfo } from "./types";
import styles from "./Home.module.css";

export function ScenarioCards({ scenarios, error, onStart, starting }: { scenarios: ScenarioInfo[] | null; error: string | null; onStart: (id: string) => void; starting: string | null }) {
  if (error) return <p className="callout tone-bad">The scenarios could not be loaded: {error}</p>;
  if (!scenarios)
    return (
      <div className={styles.cards} aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: 420, borderRadius: 16 }} />
        ))}
      </div>
    );
  return (
    <div className={styles.cards}>
      {scenarios.map((s, i) => {
        const reqs = projectRequirements(s.project).filter((r) => r.key !== "commercial");
        return (
          <article key={s.id} className={styles.card} aria-labelledby={`sc-${s.id}`}>
            <div className={styles.cardTop}>
              <span className={styles.cardNum}>0{i + 1}</span>
              <span className={styles.cardAssets} aria-label={`Assets: ${s.requiredAssetIds.map(assetLabel).join(", ")}`}>
                {s.requiredAssetIds.map((a) => (
                  <span key={a} className={styles.assetBubble} title={assetLabel(a)}>
                    <AssetIcon assetId={a} size={15} />
                  </span>
                ))}
              </span>
            </div>
            <h3 id={`sc-${s.id}`} className={styles.cardTitle}>
              {s.title}
            </h3>
            <p className={styles.cardTagline}>{s.tagline}</p>
            <blockquote className={styles.brief}>{s.brief}</blockquote>
            <dl className={styles.cardFacts}>
              {reqs.slice(0, 4).map((r) => (
                <div key={r.key}>
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
              <div>
                <dt>Licences</dt>
                <dd>
                  <FileText aria-hidden className={styles.inlineIcon} /> {s.documents.length} to read
                </dd>
              </div>
            </dl>
            <div className={styles.showcases}>
              <span className={styles.showLabel}>Rules it puts to work</span>
              <span className={styles.chips}>
                {s.showcases.map((r) => (
                  <span key={r} className="chip chip-sm chip-mono tone-engine">
                    {ruleName(r)}
                  </span>
                ))}
              </span>
            </div>
            <button type="button" className={`btn ${styles.cardBtn}`} onClick={() => onStart(s.id)} disabled={starting !== null}>
              {starting === s.id ? <Spinner label="Starting" /> : null}
              Run this scenario <ArrowRight aria-hidden />
            </button>
          </article>
        );
      })}
    </div>
  );
}
