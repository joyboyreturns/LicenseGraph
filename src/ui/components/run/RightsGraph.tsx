"use client";

import { Check, CircleDashed, FileText, FileWarning, X } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { LicenseOffer } from "@/src/core/types";
import type { Catalog } from "@/src/ui/lib/catalog";
import { assetLabel, formatMoney, termTags } from "@/src/ui/lib/format";
import { layoutGraph, type EdgePath, type GraphLayout, type NodeBox } from "@/src/ui/lib/graph-layout";
import type { RunState } from "@/src/ui/lib/replay";
import { ruleName, violationText } from "@/src/ui/lib/rule-text";
import { AssetIcon } from "../bits";
import styles from "./RightsGraph.module.css";

export interface RightsGraphProps {
  documents: readonly { id: string; assetId: string; licensorName?: string }[];
  offers: readonly LicenseOffer[];
  requiredAssetIds: readonly string[];
  state: RunState;
  catalog: Catalog;
  currency: string;
  selectedOfferId?: string;
  onSelectOffer: (offerId: string) => void;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth);
      setWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const OFFER_STATE_TEXT: Record<string, string> = {
  hidden: "not read yet",
  candidate: "candidate",
  proposed: "proposed by the agent, being verified",
  rejected: "rejected by the rules engine",
  chosen: "chosen and verified",
  alternative: "compliant, not needed",
  ineligible: "fails a rule, never chosen",
};

export const RightsGraph = memo(function RightsGraph(props: RightsGraphProps) {
  const { documents, offers, requiredAssetIds, state, catalog, currency, selectedOfferId, onSelectOffer } = props;
  const [ref, width] = useWidth<HTMLDivElement>();

  const layout: GraphLayout | null = useMemo(() => {
    if (!width) return null;
    return layoutGraph({ width, documents, offers: offers.map((o) => ({ id: o.id, assetId: o.assetId, documentId: o.evidence[0]?.documentId, priceCents: o.priceCents })), assets: requiredAssetIds });
  }, [width, documents, offers, requiredAssetIds]);

  const offerById = useMemo(() => new Map(offers.map((o) => [o.id, o])), [offers]);
  const docOffer = useMemo(() => new Map(offers.map((o) => [o.evidence[0]?.documentId ?? "", o.id])), [offers]);
  const compact = layout?.density === "compact";

  return (
    <div className={styles.wrap}>
      <div className={styles.heads} aria-hidden>
        {layout && (
          <>
            <span style={{ left: layout.columns.doc.x, width: layout.columns.doc.w }}>
              Licences <b>{documents.length}</b>
            </span>
            <span style={{ left: layout.columns.offer.x, width: layout.columns.offer.w }}>
              {compact ? "Offers" : "Offers, as read"} <b>{offers.length}</b>
            </span>
            <span style={{ left: layout.columns.asset.x, width: layout.columns.asset.w }}>
              {compact ? "Assets" : "Required assets"} <b>{requiredAssetIds.length}</b>
            </span>
          </>
        )}
      </div>
      <div ref={ref} className={`${styles.graph} ${compact ? styles.compact : ""}`} style={{ height: layout?.height ?? 320 }} role="group" aria-label="Rights graph: licences, the offers read from them, and the assets they cover" data-loop={state.loop}>
        {!layout && <div className={`skeleton ${styles.skeleton}`} />}
        {layout && (
          <>
            <svg className={styles.edges} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden focusable="false">
              <defs>
                <filter id="lg-glow" x="-20%" y="-50%" width="140%" height="200%">
                  <feGaussianBlur stdDeviation="3.2" />
                </filter>
              </defs>
              {layout.groups.map((g, i) =>
                i === 0 ? null : <line key={g.assetId} x1={0} x2={layout.width} y1={g.top - (compact ? 9 : 14)} y2={g.top - (compact ? 9 : 14)} className={styles.groupRule} />,
              )}
              {layout.edges.map((e) => (
                <Edge key={e.key} edge={e} state={state} />
              ))}
            </svg>
            {layout.nodes.map((n) => {
              if (n.kind === "doc") return <DocNode key={n.key} box={n} state={state.docs[n.id] ?? "queued"} catalog={catalog} hasOffer={docOffer.has(n.id)} compact={compact} />;
              if (n.kind === "asset") return <AssetNode key={n.key} box={n} state={state} offers={offers} currency={currency} compact={compact} />;
              const offer = offerById.get(n.id);
              if (!offer) return null;
              return <OfferNode key={n.key} box={n} offer={offer} state={state} catalog={catalog} selected={selectedOfferId === n.id} onSelect={onSelectOffer} compact={compact} layoutHeight={layout.height} />;
            })}
          </>
        )}
      </div>
      <GraphDescription {...props} />
    </div>
  );
});

function edgeState(e: EdgePath, state: RunState): string {
  const offerId = (e.kind === "doc-offer" ? e.to : e.from).slice("offer:".length);
  const s = state.offers[offerId] ?? "hidden";
  return s;
}

function Edge({ edge, state }: { edge: EdgePath; state: RunState }) {
  const s = edgeState(edge, state);
  const cls = `${styles.edge} ${styles[`edge_${edge.kind === "doc-offer" ? "read" : "use"}`]} ${styles[`e_${s}`] ?? ""}`;
  return (
    <g className={cls}>
      {s === "chosen" && edge.kind === "offer-asset" && <path d={edge.d} className={styles.glow} filter="url(#lg-glow)" />}
      <path d={edge.d} className={styles.line} pathLength={100} />
      {s === "rejected" && edge.kind === "offer-asset" && (
        <g transform={`translate(${edge.mid.x} ${edge.mid.y})`}>
          <g className={styles.strike}>
            <circle r="8" />
            <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" />
          </g>
        </g>
      )}
    </g>
  );
}

function boxStyle(b: NodeBox): CSSProperties {
  return { transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h };
}

function DocNode({ box, state, catalog, hasOffer, compact }: { box: NodeBox; state: string; catalog: Catalog; hasOffer: boolean; compact: boolean }) {
  const doc = catalog.docs.get(box.id);
  const Icon = state === "unreadable" ? FileWarning : FileText;
  return (
    <div className={`${styles.node} ${styles.doc}`} data-state={state} style={boxStyle(box)} title={doc ? `${doc.licensor}: ${doc.title}` : box.id}>
      <span className={styles.docIcon} aria-hidden>
        <Icon />
      </span>
      <span className={styles.docText}>
        <span className={styles.docName}>{doc?.licensor ?? box.id}</span>
        {!compact && <span className={styles.docTitle}>{state === "unreadable" ? "Terms could not be verified" : state === "reading" ? "Reading…" : (doc?.title ?? "")}</span>}
      </span>
      {!hasOffer && state === "unreadable" && <span className="visually-hidden">Unreadable licence</span>}
    </div>
  );
}

const STATE_BADGE: Record<string, { text: string; icon?: "check" | "x" | "dot" }> = {
  proposed: { text: "Proposed", icon: "dot" },
  rejected: { text: "Rejected", icon: "x" },
  chosen: { text: "Verified", icon: "check" },
  ineligible: { text: "Fails rules", icon: "x" },
  alternative: { text: "Compliant" },
};

function OfferNode({ box, offer, state, catalog, selected, onSelect, compact, layoutHeight }: { box: NodeBox; offer: LicenseOffer; state: RunState; catalog: Catalog; selected: boolean; onSelect: (id: string) => void; compact: boolean; layoutHeight: number }) {
  const s = state.offers[offer.id] ?? "hidden";
  const info = catalog.offer(offer.id);
  const note = state.notes[offer.id];
  const badge = STATE_BADGE[s];
  const violations = note?.violations ?? [];
  const latestRound = violations.at(-1)?.round;
  const shown = latestRound === undefined ? [] : violations.filter((v) => v.round === latestRound);
  const tags = termTags(offer.terms);
  const below = box.y + box.h / 2 < layoutHeight * 0.55;
  const label = `${info?.licensor ?? ""}, ${info?.title ?? offer.id}, ${formatMoney(offer.priceCents, offer.currency)} for the ${assetLabel(offer.assetId).toLowerCase()}. ${OFFER_STATE_TEXT[s] ?? s}${shown.length ? `: ${shown.map((v) => `${ruleName(v.rule)}, ${v.message}`).join("; ")}` : ""}. Open evidence.`;

  return (
    <button
      type="button"
      className={`${styles.node} ${styles.offer}`}
      data-state={s}
      data-selected={selected || undefined}
      style={boxStyle(box)}
      onClick={() => onSelect(offer.id)}
      aria-label={label}
      tabIndex={s === "hidden" ? -1 : 0}
      aria-hidden={s === "hidden" ? true : undefined}
    >
      <span className={styles.offerTop}>
        <span className={`${styles.price} num`}>{formatMoney(offer.priceCents, offer.currency, { trim: true })}</span>
        {!compact && <span className={styles.offerTitle}>{info?.title}</span>}
        {badge && (
          <span className={styles.badge} data-kind={s}>
            {badge.icon === "check" ? <Check aria-hidden /> : badge.icon === "x" ? <X aria-hidden /> : badge.icon === "dot" ? <span className={styles.badgeDot} /> : null}
            {!compact && badge.text}
            {s === "rejected" && latestRound !== undefined && !compact && <span className={styles.round}>R{latestRound}</span>}
          </span>
        )}
      </span>
      <span className={styles.tags}>
        {(compact ? tags.slice(0, 2) : tags).map((t) => (
          <span key={t} className={styles.tag} data-warn={t === "Non-comm." || undefined}>
            {t}
          </span>
        ))}
      </span>
      {shown.length > 0 && (
        <span className={`${styles.tip} ${below ? styles.tipBelow : styles.tipAbove}`} role="presentation">
          <span className={styles.tipHead}>Rules engine, round {latestRound}</span>
          {shown.map((v, i) => (
            <span key={i} className={styles.tipRow}>
              <b>{ruleName(v.rule)}</b> {violationText(v, offer.currency)}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

function AssetNode({ box, state, offers, currency, compact }: { box: NodeBox; state: RunState; offers: readonly LicenseOffer[]; currency: string; compact: boolean }) {
  const s = state.assets[box.id] ?? "open";
  const chosen = offers.find((o) => o.assetId === box.id && state.chosen.includes(o.id));
  const proposed = offers.find((o) => o.assetId === box.id && state.activeProposal.includes(o.id));
  const count = offers.filter((o) => o.assetId === box.id).length;
  const status = s === "covered" && chosen ? `Covered · ${formatMoney(chosen.priceCents, chosen.currency || currency, { trim: true })}` : s === "proposed" && proposed ? `Checking ${formatMoney(proposed.priceCents, proposed.currency, { trim: true })}` : s === "rejected" ? "Pick rejected" : count === 0 ? "No offers" : `${count} ${count === 1 ? "offer" : "offers"}`;
  return (
    <div className={`${styles.node} ${styles.asset}`} data-state={s} style={boxStyle(box)}>
      <span className={styles.assetIcon} aria-hidden>
        {s === "covered" ? <Check /> : <AssetIcon assetId={box.id} size={compact ? 15 : 17} />}
      </span>
      <span className={styles.assetText}>
        <span className={styles.assetName}>{assetLabel(box.id)}</span>
        <span className={styles.assetStatus}>{status}</span>
      </span>
      {s === "open" && count === 0 && <CircleDashed className={styles.assetWarn} aria-hidden />}
    </div>
  );
}

/** A text version of the graph for screen readers and anyone who prefers a list. */
function GraphDescription({ requiredAssetIds, offers, state, catalog }: RightsGraphProps) {
  return (
    <div className="visually-hidden">
      <h3>Rights graph as a list</h3>
      <ul>
        {requiredAssetIds.map((a) => {
          const list = offers.filter((o) => o.assetId === a).sort((x, y) => x.priceCents - y.priceCents);
          return (
            <li key={a}>
              {assetLabel(a)}: {state.assets[a] === "covered" ? "covered by a verified licence" : `${list.length} offers`}.
              <ul>
                {list.map((o) => {
                  const s = state.offers[o.id] ?? "hidden";
                  const v = state.notes[o.id]?.violations ?? [];
                  return (
                    <li key={o.id}>
                      {catalog.offerName(o.id)}: {OFFER_STATE_TEXT[s]}
                      {v.length ? `. Violations: ${v.map((x) => `round ${x.round}, ${ruleName(x.rule)}: ${x.message}`).join("; ")}` : ""}.
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
