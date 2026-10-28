"use client";

import { BadgeCheck, CircleX, CreditCard, FileText, FileWarning, Repeat, Scale, Send, Sparkles, UserCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { LedgerEvent } from "@/src/ledger/chain";
import type { Catalog } from "@/src/ui/lib/catalog";
import { humaniseIds } from "@/src/ui/lib/catalog";
import { eventTitle } from "@/src/ui/lib/event-text";
import { assetLabel, assetNoun, dateTimeText, formatMoney, isSimulatedId, pluralise } from "@/src/ui/lib/format";
import type { RunState } from "@/src/ui/lib/replay";
import { buildStory, violationsByOffer, type Round } from "@/src/ui/lib/rounds";
import { isBundleRule, ruleName, violationText } from "@/src/ui/lib/rule-text";
import { Spinner } from "../bits";
import styles from "./AgentTimeline.module.css";

interface Props {
  events: readonly LedgerEvent[];
  state: RunState;
  loopStatus?: string;
  catalog: Catalog;
  currency: string;
  /** Number of rules the engine checks per licence, for the verified summary. */
  ruleCount: number;
  autoScroll: boolean;
  reducedMotion: boolean;
  onSelectOffer: (id: string) => void;
}

export function AgentTimeline({ events, state, loopStatus, catalog, currency, ruleCount, autoScroll, reducedMotion, onSelectOffer }: Props) {
  const applied = useMemo(() => events.slice(0, state.cursor), [events, state.cursor]);
  const story = useMemo(() => buildStory(applied, state.atEnd ? loopStatus : undefined), [applied, state.atEnd, loopStatus]);
  const listRef = useRef<HTMLDivElement>(null);
  const currentSeq = state.current?.seq;

  useEffect(() => {
    if (!autoScroll) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }, [state.cursor, autoScroll, reducedMotion]);

  const pendingRevision = state.loop === "proposing";
  const pendingRead = state.loop === "reading" || state.loop === "idle";

  return (
    <div className={styles.wrap}>
      <div className={styles.legend} aria-hidden>
        <span className={styles.legendAgent}>
          <Sparkles /> Agent (AI model)
        </span>
        <span className={styles.legendEngine}>
          <Scale /> Rules engine (code, not AI)
        </span>
      </div>
      <div ref={listRef} className={styles.scroll} tabIndex={0} aria-label="Agent timeline">
        <ol className={styles.list}>
          <li className={styles.item} data-current={story.reading.read.some((r) => r.seq === currentSeq) || story.reading.failed.some((r) => r.seq === currentSeq) || undefined}>
            <div className={`${styles.voice} ${styles.agent}`}>
              <div className={styles.voiceHead}>
                <span className={styles.who}>
                  <Sparkles aria-hidden /> Agent
                </span>
                <span className={styles.what}>reads the licences</span>
                {pendingRead && state.cursor < state.total && <Spinner size={13} label="Reading" />}
              </div>
              {story.reading.read.length === 0 && story.reading.failed.length === 0 ? (
                <p className={styles.quiet}>Waiting to read {state.cursor === 0 && state.total > 0 ? "the licences" : "licences"}…</p>
              ) : (
                <>
                  <p className={styles.summary}>
                    Read {pluralise(story.reading.read.length, "licence")}
                    {story.reading.failed.length ? `, ${story.reading.failed.length} unreadable` : ""}. <b>{story.reading.quotes}</b> terms linked to the exact sentence they came from.
                  </p>
                  <ul className={styles.reads}>
                    {story.reading.read.map((r) => {
                      const info = catalog.offer(r.offerId);
                      return (
                        <li key={r.seq} data-current={r.seq === currentSeq || undefined}>
                          <button type="button" className={styles.readBtn} onClick={() => onSelectOffer(r.offerId)} aria-label={`${info?.name ?? r.offerId}: open evidence`}>
                            <FileText aria-hidden />
                            <span className="truncate">{info?.licensor ?? r.documentId}</span>
                            <span className={styles.readAsset}>{assetNoun(r.assetId)}</span>
                            <span className={`${styles.readPrice} num`}>{formatMoney(r.priceCents, currency, { trim: true })}</span>
                          </button>
                        </li>
                      );
                    })}
                    {story.reading.failed.map((f) => (
                      <li key={f.seq} className={styles.readFailed} data-current={f.seq === currentSeq || undefined}>
                        <FileWarning aria-hidden />
                        <span>
                          <b>{catalog.docs.get(f.documentId)?.licensor ?? f.documentId}</b>: terms could not be verified. {f.problems.slice(0, 2).join("; ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </li>

          {story.rounds.map((r) => (
            <RoundItem key={r.round} round={r} catalog={catalog} currency={currency} currentSeq={currentSeq} ruleCount={ruleCount} checking={state.loop === "verifying" && r === story.rounds.at(-1)} onSelectOffer={onSelectOffer} />
          ))}

          {pendingRevision && (
            <li className={styles.item}>
              <div className={`${styles.voice} ${styles.agent} ${styles.pending}`}>
                <div className={styles.voiceHead}>
                  <span className={styles.who}>
                    <Sparkles aria-hidden /> Agent
                  </span>
                  <span className={styles.what}>{story.rounds.length ? "is revising after the rejection" : "is choosing a bundle"}</span>
                  <Spinner size={13} label="Working" />
                </div>
              </div>
            </li>
          )}

          {story.after.map((e) => (
            <AfterItem key={e.seq} event={e} current={e.seq === currentSeq} currency={currency} />
          ))}
        </ol>
      </div>
    </div>
  );
}

function OfferChip({ id, catalog, onSelect, tone }: { id: string; catalog: Catalog; onSelect: (id: string) => void; tone?: "bad" | "ok" }) {
  const info = catalog.offer(id);
  return (
    <button type="button" className={styles.offerChip} data-tone={tone} onClick={() => onSelect(id)} aria-label={`${info?.name ?? id}: open evidence`}>
      <span className="truncate">{info?.licensor ?? id}</span>
      <span className={styles.offerChipMeta}>
        {info ? assetNoun(info.assetId) : ""} · <span className="num">{info?.price}</span>
      </span>
    </button>
  );
}

function RoundItem({ round, catalog, currency, currentSeq, ruleCount, checking, onSelectOffer }: { round: Round; catalog: Catalog; currency: string; currentSeq?: number; ruleCount: number; checking: boolean; onSelectOffer: (id: string) => void }) {
  const current = [round.proposal?.seq, round.verdict?.seq, round.error?.seq].includes(currentSeq);
  const v = round.verdict;
  const rejectedIds = new Set(v?.status === "rejected" ? v.violations.map((x) => x.offerId).filter(Boolean) : []);
  return (
    <li className={styles.item} data-current={current || undefined}>
      <div className={styles.roundHead}>
        <span className={styles.roundNo}>Round {round.round}</span>
        {v?.status === "rejected" && <span className={`chip chip-sm tone-bad`}>Rejected</span>}
        {v?.status === "verified" && <span className={`chip chip-sm tone-ok`}>Verified</span>}
        {round.error && <span className={`chip chip-sm tone-bad`}>Unusable</span>}
        {round.repeated && <span className={`chip chip-sm tone-bad`}>Repeated</span>}
      </div>

      {round.proposal && (
        <div className={`${styles.voice} ${styles.agent}`}>
          <div className={styles.voiceHead}>
            <span className={styles.who}>
              <Sparkles aria-hidden /> Agent
            </span>
            <span className={styles.what}>{round.proposal.kind === "proposed" ? "proposes" : "revises the proposal"}</span>
          </div>
          <div className={styles.chips}>
            {round.proposal.offerIds.map((id) => (
              <OfferChip key={id} id={id} catalog={catalog} onSelect={onSelectOffer} tone={rejectedIds.has(id) ? "bad" : v?.status === "verified" ? "ok" : undefined} />
            ))}
          </div>
          {round.proposal.rationale && <p className={styles.rationale}>“{humaniseIds(round.proposal.rationale, catalog)}”</p>}
        </div>
      )}

      {round.error && (
        <div className={`${styles.voice} ${styles.engine}`}>
          <div className={styles.voiceHead}>
            <span className={styles.who}>
              <Scale aria-hidden /> Loop guard
            </span>
            <span className={styles.what}>refused the proposal</span>
          </div>
          <p className={styles.verdictLine}>{humaniseIds(round.error.message, catalog)}</p>
        </div>
      )}

      {round.proposal && (v || checking || round.repeated) && (
        <div className={`${styles.voice} ${styles.engine}`}>
          <div className={styles.voiceHead}>
            <span className={styles.who}>
              <Scale aria-hidden /> Rules engine
            </span>
            <span className={styles.what}>code, not AI</span>
          </div>
          {!v && checking && (
            <p className={styles.checking}>
              <Spinner size={13} /> Checking {pluralise(round.proposal.offerIds.length, "licence")} against every rule…
            </p>
          )}
          {round.repeated && (
            <p className={styles.verdictLine}>
              <Repeat aria-hidden className={styles.inlineIcon} /> The agent repeated a bundle that was already rejected, so the loop stopped. No compliant bundle was found.
            </p>
          )}
          {v?.status === "rejected" && <Rejection violations={v.violations} catalog={catalog} currency={currency} onSelectOffer={onSelectOffer} />}
          {v?.status === "verified" && (
            <div className={styles.verified}>
              <span className={styles.stamp}>
                <BadgeCheck aria-hidden /> Verified
              </span>
              <span className={styles.verifiedText}>
                {pluralise(v.offerIds.length, "licence")} passed every rule this project requires{ruleCount ? ` (${ruleCount} checked per licence)` : ""}, plus the bundle checks. Total <b className="num">{formatMoney(v.totalCents, currency)}</b>.
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Rejection({ violations, catalog, currency, onSelectOffer }: { violations: Parameters<typeof violationsByOffer>[0]; catalog: Catalog; currency: string; onSelectOffer: (id: string) => void }) {
  const groups = [...violationsByOffer(violations).entries()];
  return (
    <div className={styles.rejection}>
      <p className={styles.verdictLine}>
        <CircleX aria-hidden className={styles.inlineIconBad} />
        <b>Rejected</b> with {pluralise(violations.length, "violation")}. Sent back to the agent verbatim.
      </p>
      <ul className={styles.violations}>
        {groups.map(([offerId, list]) => (
          <li key={offerId || "bundle"}>
            <div className={styles.violationOffer}>
              {offerId ? (
                <button type="button" className={styles.linkish} onClick={() => onSelectOffer(offerId)}>
                  {catalog.offerName(offerId)}
                </button>
              ) : (
                <span>Whole bundle</span>
              )}
            </div>
            <ul>
              {list.map((v, i) => (
                <li key={i}>
                  <span className={`chip chip-sm chip-mono ${isBundleRule(v.rule) ? "tone-engine" : "tone-bad"}`}>{ruleName(v.rule)}</span>
                  <span>
                    {!offerId && v.assetId ? <b>{assetLabel(v.assetId)}: </b> : null}
                    {violationText(v, currency)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AfterItem({ event, current, currency }: { event: LedgerEvent; current: boolean; currency: string }) {
  const p = event.payload;
  const icon =
    event.kind === "approved" ? <UserCheck aria-hidden /> : event.kind === "order_created" ? <CreditCard aria-hidden /> : event.kind === "captured" ? <Wallet aria-hidden /> : <Send aria-hidden />;
  const tone = event.kind === "payout_failed" || event.kind === "capture_mismatch" || event.kind === "payment_reversed" ? "bad" : event.kind === "approved" ? "human" : "pay";
  let detail: string | null = null;
  if (event.kind === "approved") detail = dateTimeText(event.at);
  if (event.kind === "order_created" || event.kind === "captured") {
    const id = String(event.kind === "captured" ? (p.captureId ?? "") : (p.orderId ?? ""));
    detail = `${id}${isSimulatedId(id) ? " (simulated)" : " (Sandbox)"}`;
  }
  if (event.kind === "payout_created" && typeof p.totalCents === "number") detail = `${formatMoney(p.totalCents, typeof p.currency === "string" ? p.currency : currency)} in one batch`;
  if (event.kind === "payout_failed") detail = String(p.error ?? "");
  return (
    <li className={`${styles.item} ${styles.after}`} data-current={current || undefined} data-tone={tone}>
      <span className={styles.afterIcon}>{icon}</span>
      <span className={styles.afterText}>
        <b>{eventTitle(event)}</b>
        {detail && <span className={`${styles.afterDetail} ${event.kind === "order_created" || event.kind === "captured" ? "mono" : ""}`}>{detail}</span>}
      </span>
    </li>
  );
}
