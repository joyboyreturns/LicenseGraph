"use client";

import { Check, CircleHelp, Minus, Quote, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { OfferEvaluation } from "@/src/core/analysis";
import type { RuleId, LicenseOffer } from "@/src/core/types";
import type { Catalog } from "@/src/ui/lib/catalog";
import { segmentText } from "@/src/ui/lib/evidence";
import { assetLabel, formatMoney, termLines, type TermKey } from "@/src/ui/lib/format";
import type { OfferState } from "@/src/ui/lib/replay";
import { ruleChecks, ruleName, violationText } from "@/src/ui/lib/rule-text";
import { Drawer } from "../Drawer";
import { AssetIcon } from "../bits";
import styles from "./EvidenceViewer.module.css";

const TERM_RULE: Partial<Record<TermKey, RuleId>> = {
  commercialUse: "commercial-use",
  territories: "territory",
  term: "term",
  fixedEndDate: "term",
  mediums: "medium",
  attribution: "attribution",
  sublicensing: "sublicensing",
  exclusivity: "exclusivity",
  offerValidUntil: "expiry",
};

const FIELD_LABEL: Record<string, string> = {
  price: "Price",
  commercialUse: "Commercial use",
  territories: "Territory",
  term: "Term",
  mediums: "Media",
  attribution: "Credit",
  sublicensing: "Sublicensing",
  exclusivity: "Exclusivity",
  fixedEndDate: "End date",
  offerValidUntil: "Offer validity",
};

const STATE_TEXT: Partial<Record<OfferState, { label: string; tone: string }>> = {
  chosen: { label: "In the verified bundle", tone: "tone-ok" },
  rejected: { label: "Rejected by the rules engine", tone: "tone-bad" },
  proposed: { label: "Proposed, being verified", tone: "tone-agent" },
  ineligible: { label: "Fails a rule", tone: "tone-bad" },
  alternative: { label: "Compliant, not needed", tone: "tone-neutral" },
  candidate: { label: "Candidate", tone: "tone-neutral" },
};

export interface EvidenceViewerProps {
  offer: LicenseOffer | undefined;
  document: { id: string; text: string } | undefined;
  evaluation: OfferEvaluation | undefined;
  catalog: Catalog;
  state: OfferState | undefined;
  onClose: () => void;
}

export function EvidenceViewer({ offer, document, evaluation, catalog, state, onClose }: EvidenceViewerProps) {
  const info = offer ? catalog.offer(offer.id) : undefined;
  return (
    <Drawer
      open={Boolean(offer)}
      onClose={onClose}
      title={info ? `${info.licensor}` : "Licence"}
      subtitle={
        offer && (
          <span className={styles.sub}>
            <span className={styles.subAsset}>
              <AssetIcon assetId={offer.assetId} size={14} /> {assetLabel(offer.assetId)}
            </span>
            <span>{info?.title}</span>
            <span className="num" style={{ fontWeight: 650, color: "var(--ink)" }}>
              {formatMoney(offer.priceCents, offer.currency)}
            </span>
            {state && STATE_TEXT[state] && <span className={`chip chip-sm ${STATE_TEXT[state]!.tone}`}>{STATE_TEXT[state]!.label}</span>}
          </span>
        )
      }
    >
      {offer && <EvidenceBody key={offer.id} offer={offer} document={document} evaluation={evaluation} />}
    </Drawer>
  );
}

function EvidenceBody({ offer, document, evaluation }: { offer: LicenseOffer; document?: { id: string; text: string }; evaluation?: OfferEvaluation }) {
  const text = document?.text ?? "";
  const ranges = useMemo(() => offer.evidence.map((e, i) => ({ id: `${e.field ?? "quote"}#${i}`, start: e.start, end: e.end, quote: e.quote })), [offer]);
  const seg = useMemo(() => segmentText(text, ranges), [text, ranges]);
  const fieldsOf = (ids: string[]) => [...new Set(ids.map((id) => id.split("#")[0]!))];
  const [active, setActive] = useState<{ field: string; n: number } | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const lines = termLines(offer.terms, offer.priceCents, offer.currency);
  const result = (rule?: RuleId) => (rule ? evaluation?.results.find((r) => r.rule === rule) : undefined);
  const quoted = new Set(offer.evidence.map((e) => e.field ?? ""));

  const jump = useCallback((field: string) => {
    setActive((a) => ({ field, n: (a?.n ?? 0) + 1 }));
    const el = textRef.current?.querySelector<HTMLElement>(`[data-fields~="${field}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, []);

  const gaps = lines.filter((l) => !l.stated);

  return (
    <div className={styles.body}>
      <section aria-labelledby="ev-terms">
        <div className={styles.sectionHead}>
          <h3 id="ev-terms" className={styles.h3}>
            Terms the agent read
          </h3>
          <p className={styles.hint}>Select a term to see the sentence it came from.</p>
        </div>
        <div className={styles.terms}>
          {lines.map((l) => {
            const r = result(TERM_RULE[l.key]);
            const status = l.key === "price" ? "neutral" : r?.status === "fail" ? "fail" : r?.status === "pass" ? "pass" : "skip";
            const hasQuote = quoted.has(l.key);
            const Icon = status === "fail" ? X : status === "pass" ? Check : Minus;
            return (
              <button
                key={l.key}
                type="button"
                className={styles.term}
                data-status={status}
                data-gap={!l.stated || undefined}
                data-active={active?.field === l.key || undefined}
                onClick={() => hasQuote && jump(l.key)}
                aria-disabled={!hasQuote}
                aria-label={`${l.label}: ${l.value}. ${status === "fail" ? "Fails the rules." : status === "pass" ? "Passes the rules." : l.key === "price" ? "" : "Not required by this project."} ${hasQuote ? "Show the quote." : "No quote: the licence does not state it."}`}
              >
                <span className={styles.termLabel}>
                  {l.label}
                  {l.key !== "price" && (
                    <span className={styles.termIcon} aria-hidden>
                      <Icon />
                    </span>
                  )}
                </span>
                <span className={styles.termValue}>{l.value}</span>
                <span className={styles.termFoot}>{hasQuote ? <><Quote aria-hidden /> Show quote</> : <><CircleHelp aria-hidden /> Not in the licence</>}</span>
              </button>
            );
          })}
        </div>
        {gaps.length > 0 && (
          <div className={styles.gaps}>
            <strong>Gaps.</strong> This licence says nothing about {gaps.map((g) => g.label.toLowerCase()).join(", ")}.{" "}
            {gaps.some((g) => result(TERM_RULE[g.key])?.status === "fail")
              ? "The project requires at least one of these, and silence fails the rule: the engine never assumes a term the licence does not state."
              : "None of these are required by this project, so the rules engine skips them."}
          </div>
        )}
      </section>

      <section aria-labelledby="ev-text" className={styles.docSection}>
        <div className={styles.sectionHead}>
          <h3 id="ev-text" className={styles.h3}>
            Licence text
          </h3>
          <p className={styles.hint}>
            {seg.placed.length} of {ranges.length} quotes found at their recorded position{seg.placed.some((p) => p.via === "search") ? " (some located by searching the text)" : ""}.
          </p>
        </div>
        <div ref={textRef} className={styles.doc} tabIndex={0} aria-label="Licence text with quoted evidence highlighted">
          {text ? (
            seg.segments.map((s) => {
              if (!s.marks.length) return <span key={s.start}>{s.text}</span>;
              const fields = fieldsOf(s.marks);
              const isActive = active && fields.includes(active.field);
              return (
                <mark key={`${s.start}-${isActive ? active!.n : 0}`} className={styles.mark} data-fields={fields.join(" ")} data-active={isActive || undefined} title={`Evidence for: ${fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}`}>
                  {s.text}
                </mark>
              );
            })
          ) : (
            <p className="muted">The licence text is not available for this offer.</p>
          )}
        </div>
        {seg.unplaced.length > 0 && (
          <div className={styles.unplaced}>
            <strong>Quotes not found in this text:</strong>
            <ul>
              {seg.unplaced.map((id) => {
                const i = Number(id.split("#")[1]);
                const e = offer.evidence[i];
                return <li key={id}>{e ? `${FIELD_LABEL[e.field ?? ""] ?? e.field}: “${e.quote}”` : id}</li>;
              })}
            </ul>
          </div>
        )}
      </section>

      {evaluation && (
        <section aria-labelledby="ev-rules">
          <div className={styles.sectionHead}>
            <h3 id="ev-rules" className={styles.h3}>
              Rules engine, this licence on its own
            </h3>
            <p className={styles.hint}>Deterministic code: the same terms always get the same answer.</p>
          </div>
          <ul className={styles.rules}>
            {evaluation.results.map((r) => (
              <li key={r.rule} data-status={r.status}>
                <span className={styles.ruleIcon} aria-hidden>
                  {r.status === "pass" ? <Check /> : r.status === "fail" ? <X /> : <Minus />}
                </span>
                <span className={styles.ruleName}>{ruleName(r.rule)}</span>
                <span className={styles.ruleDetail}>{r.status === "fail" ? r.messages.map((m) => violationText({ rule: r.rule, message: m }, offer.currency)).join(" ") : r.status === "pass" ? ruleChecks(r.rule) : "Not required by this project."}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
