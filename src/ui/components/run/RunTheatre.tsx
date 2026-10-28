"use client";

import { ArrowDown, BadgeCheck, CircleX, ExternalLink, FastForward, FileBadge, LayoutGrid, RefreshCw, Scale, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionView } from "@/src/app-logic/session";
import { RULE_CATALOG } from "@/src/core/rules";
import { api, errorMessage } from "@/src/ui/lib/api";
import { buildCatalog, type Catalog } from "@/src/ui/lib/catalog";
import { formatMoney, isSimulatedId, pluralise, projectRequirements } from "@/src/ui/lib/format";
import { deriveRunState, isActivePhase, type RunState } from "@/src/ui/lib/replay";
import { useConfig, useToast } from "../Providers";
import { storageGet, storageSet, useNow, useReducedMotion } from "../bits";
import { AgentTimeline } from "./AgentTimeline";
import { ApprovalPanel } from "./ApprovalPanel";
import { AskPanel } from "./AskPanel";
import { ComplianceSummary } from "./ComplianceSummary";
import { EvidenceViewer } from "./EvidenceViewer";
import { FailurePanel } from "./FailurePanel";
import { LedgerPanel } from "./LedgerPanel";
import { ReplayController } from "./ReplayController";
import { RightsGraph } from "./RightsGraph";
import { RunHeader, StepRail } from "./RunHeader";
import { SettlementPanel } from "./SettlementPanel";
import { useReplay } from "./useReplay";
import { useSession } from "./useSession";
import { VerificationMatrix } from "./VerificationMatrix";
import styles from "./RunTheatre.module.css";

const SCENARIO_TITLES: Record<string, string> = { documentary: "Documentary promo", "game-trailer": "Game launch trailer", podcast: "Podcast network" };
const seenKey = (id: string) => `lg-replayed:${id}`;
const concluded = (phase: string) => phase === "verified" || phase === "failed";

export function RunTheatre({ id }: { id: string }) {
  const { load, accept, refresh } = useSession(id);
  if (load.status === "loading") return <TheatreSkeleton />;
  if (load.status === "not-found") return <RunNotFound id={id} />;
  if (load.status === "error")
    return (
      <div className={`container ${styles.empty}`}>
        <p className="eyebrow">Run {id.slice(0, 8)}</p>
        <h1 className={styles.emptyTitle}>We could not load this run</h1>
        <p className={styles.emptyText}>{load.message}</p>
        <button type="button" className="btn btn-primary" onClick={refresh}>
          <RefreshCw aria-hidden /> Try again
        </button>
      </div>
    );
  return <Theatre view={load.view} accept={accept} refresh={refresh} />;
}

function captionFor(state: RunState, view: SessionView, catalog: Catalog): { tone: string; text: string } {
  const currency = view.bundle?.currency ?? view.candidates[0]?.currency ?? "USD";
  const read = Object.values(state.docs).filter((d) => d === "read" || d === "unreadable").length;
  switch (state.loop) {
    case "idle":
      return { tone: "neutral", text: state.total ? "Press play to watch the agent and the rules engine work." : "Starting the run…" };
    case "reading":
      return { tone: "agent", text: `Agent is reading licence ${Math.min(read + 1, view.documents.length)} of ${view.documents.length}, linking every term to the sentence it came from.` };
    case "verifying":
      return { tone: "engine", text: `Round ${state.round}: the agent proposed ${pluralise(state.activeProposal.length, "licence")}. The rules engine is checking every rule.` };
    case "rejected": {
      const v = state.verdict?.kind === "rejected" ? state.verdict.violations : [];
      const offers = new Set(v.map((x) => x.offerId).filter(Boolean));
      return { tone: "bad", text: `Round ${state.round} rejected: ${pluralise(v.length, "violation")}${offers.size ? ` across ${pluralise(offers.size, "licence")}` : ""}. The violations go back to the agent.` };
    }
    case "proposing":
      return { tone: "agent", text: state.round ? `The agent is revising after round ${state.round}…` : "The agent is choosing a bundle…" };
    case "error":
      return { tone: "bad", text: `Round ${state.round}: the proposal could not be used. The agent tries again.` };
    case "verified":
      return { tone: "ok", text: `Verified in round ${state.round}: ${pluralise(state.chosen.length, "licence")} for ${formatMoney(state.verdict?.kind === "verified" ? state.verdict.totalCents : (view.bundle?.totalCents ?? 0), currency)}.${state.atEnd && view.phase === "verified" ? " Waiting for your approval." : ""}` };
    case "failed":
      return { tone: "bad", text: view.failure ?? "No compliant bundle was found." };
    default:
      void catalog;
      return { tone: "neutral", text: "" };
  }
}

function Theatre({ view, accept, refresh }: { view: SessionView; accept: (v: SessionView) => void; refresh: () => Promise<void> }) {
  const reducedMotion = useReducedMotion();
  const { config } = useConfig();
  const toast = useToast();

  // Auto-play once, the first time a finished run is opened in this browser.
  const [autoplay, setAutoplay] = useState(() => {
    if (typeof window === "undefined" || !concluded(view.phase) || storageGet(seenKey(view.id))) return false;
    return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (autoplay) storageSet(seenKey(view.id), "1");
  }, [autoplay, view.id]);
  const firstPhase = useRef(view.phase);
  useEffect(() => {
    // A replayed scenario caught mid-run: play it from the start once it finishes.
    if (isActivePhase(firstPhase.current) && view.meta?.runKind !== "live" && concluded(view.phase) && !storageGet(seenKey(view.id))) {
      firstPhase.current = view.phase;
      setAutoplay(true);
    }
  }, [view.phase, view.id, view.meta?.runKind]);

  const replay = useReplay(view.events, { autoplay, reducedMotion });
  const catalog = useMemo(() => buildCatalog(view.documents, view.candidates), [view.documents, view.candidates]);
  const requiredAssetIds = useMemo(() => view.analysis?.assets.map((a) => a.assetId) ?? [...new Set(view.documents.map((d) => d.assetId))], [view.analysis, view.documents]);
  const nonCompliant = useMemo(() => new Set(view.analysis?.evaluations.filter((e) => !e.compliant).map((e) => e.offerId) ?? []), [view.analysis]);
  const state = useMemo(
    () => deriveRunState({ events: view.events, cursor: replay.cursor, documents: view.documents, offers: view.candidates, requiredAssetIds, livePhase: view.phase, nonCompliant }),
    [view.events, replay.cursor, view.documents, view.candidates, requiredAssetIds, view.phase, nonCompliant],
  );
  const currency = view.bundle?.currency ?? view.candidates[0]?.currency ?? "USD";
  const live = isActivePhase(view.phase);

  const [selected, setSelected] = useState<string | undefined>();
  const closeEvidence = useCallback(() => setSelected(undefined), []);
  const selectedOffer = view.candidates.find((o) => o.id === selected);

  // Flash a verdict stamp when the playhead lands on a verdict (not on first paint).
  const [flash, setFlash] = useState<number | null>(null);
  const prevCursor = useRef(replay.cursor);
  useEffect(() => {
    if (prevCursor.current !== replay.cursor && replay.cursor === prevCursor.current + 1) setFlash(replay.cursor);
    prevCursor.current = replay.cursor;
  }, [replay.cursor]);
  const flashKind = flash === replay.cursor ? state.current?.kind : undefined;

  useEffect(() => {
    document.title = `${view.project.name} · LicenseGraph`;
  }, [view.project.name]);

  const now = useNow(live);
  const lastAt = view.events.at(-1)?.at;
  const created = Date.parse(view.createdAt);
  const elapsedMs = !state.atEnd ? (state.current ? Date.parse(state.current.at) - created : 0) : (live ? now : lastAt ? Date.parse(lastAt) : created) - created;

  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, path: string, body: unknown, success?: (v: SessionView) => string | null) => {
      setBusy(key);
      try {
        const v = await api<SessionView>(`/api/sessions/${view.id}/${path}`, { method: "POST", json: body });
        accept(v);
        const msg = success?.(v);
        if (msg) toast.push({ tone: "ok", title: msg });
      } catch (e) {
        const raw = errorMessage(e);
        const friendly = /ORDER_NOT_APPROVED/.test(raw) ? "The buyer has not approved this order yet. Open the checkout and approve it first, then complete the payment." : raw;
        toast.push({ tone: "bad", title: key === "approve" ? "Approval failed" : key === "pay" ? "Could not create the order" : key === "capture" ? "Payment not completed" : key === "refund" ? "Refund not made" : "Payouts not sent", body: friendly });
        void refresh();
      } finally {
        setBusy(null);
      }
    },
    [view.id, accept, toast, refresh],
  );

  const simulated = config?.paymentsMode === "simulator" || isSimulatedId(view.order?.id);
  const replaying = !replay.following || replay.playing;
  const scrollTo = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });

  let cta: React.ReactNode = null;
  if (replaying && view.events.length) {
    cta = (
      <button type="button" className="btn btn-lg" onClick={replay.skipToEnd}>
        <FastForward aria-hidden /> Skip to result
      </button>
    );
  } else if (view.phase === "verified") {
    cta = (
      <button type="button" className="btn btn-ok btn-lg" onClick={() => scrollTo("decide")}>
        <ArrowDown aria-hidden /> Review and approve
      </button>
    );
  } else if (view.phase === "approved") {
    cta = (
      <button type="button" className="btn btn-primary btn-lg" onClick={() => scrollTo("decide")}>
        <ArrowDown aria-hidden /> Create the order
      </button>
    );
  } else if (view.phase === "order_created" && view.order) {
    cta = (
      <a href={view.order.approveUrl} className="btn btn-primary btn-lg">
        <ExternalLink aria-hidden /> {simulated ? "Open payment simulator" : "Open PayPal checkout"}
      </a>
    );
  } else if (view.phase === "captured" || view.phase === "settled") {
    cta = (
      <Link prefetch={false} href={`/passport/${view.id}`} className="btn btn-ok btn-lg">
        <FileBadge aria-hidden /> View Licence Passport
      </Link>
    );
  } else if (view.phase === "failed") {
    cta = (
      <button type="button" className="btn btn-lg" onClick={() => scrollTo("decide")}>
        <ArrowDown aria-hidden /> Why it failed
      </button>
    );
  }

  const caption = captionFor(state, view, catalog);
  const requirements = projectRequirements(view.project, currency);
  const showSettlement = ["approved", "order_created", "captured", "settled", "refunded"].includes(view.phase);

  return (
    <div className="container-wide">
      <RunHeader
        name={view.project.name}
        runKind={view.meta?.runKind}
        phase={state.phase}
        elapsedMs={elapsedMs}
        live={live}
        scenarioTitle={view.meta?.scenarioId ? (SCENARIO_TITLES[view.meta.scenarioId] ?? view.meta.scenarioId) : undefined}
        actions={
          <>
            <Link prefetch={false} href={`/dashboard?session=${view.id}`} className="btn btn-lg btn-ghost">
              <LayoutGrid aria-hidden /> Dashboard
            </Link>
            {cta}
          </>
        }
      />
      <StepRail state={state} />

      <div className={styles.top}>
        <section className={`card ${styles.graphCard}`} aria-labelledby="graph-title">
          <div className={styles.graphHead}>
            <div className={styles.graphTitles}>
              <h2 id="graph-title" className="card-title">
                Rights graph
              </h2>
              <p className={styles.caption} data-tone={caption.tone} aria-live="polite">
                {caption.tone === "agent" ? <Sparkles aria-hidden /> : caption.tone === "engine" ? <Scale aria-hidden /> : caption.tone === "ok" ? <BadgeCheck aria-hidden /> : caption.tone === "bad" ? <CircleX aria-hidden /> : null}
                <span>{caption.text}</span>
              </p>
            </div>
          </div>
          <div className={styles.reqs} aria-label="What the project requires">
            <span className={styles.reqsLabel}>Project needs</span>
            {requirements.map((r) => (
              <span key={r.key} className={styles.req}>
                <span className={styles.reqKey}>{r.label}</span> {r.value}
              </span>
            ))}
          </div>
          <div className={styles.graphBody}>
            <RightsGraph documents={view.documents} offers={view.candidates} requiredAssetIds={requiredAssetIds} state={state} catalog={catalog} currency={currency} selectedOfferId={selected} onSelectOffer={setSelected} />
            {flashKind === "verified" && state.verdict?.kind === "verified" && (
              <div key={`v${replay.cursor}`} className={`${styles.stamp} ${styles.stampOk}`} aria-hidden>
                <BadgeCheck />
                <span>Verified</span>
                <small className="num">{formatMoney(state.verdict.totalCents, currency)}</small>
              </div>
            )}
            {flashKind === "rejected" && state.verdict?.kind === "rejected" && (
              <div key={`r${replay.cursor}`} className={`${styles.stamp} ${styles.stampBad}`} aria-hidden>
                <CircleX />
                <span>Rejected</span>
                <small>{pluralise(state.verdict.violations.length, "violation")}</small>
              </div>
            )}
          </div>
          <ReplayController replay={replay} events={view.events} live={live} catalog={catalog} />
        </section>

        <section className={`card ${styles.timelineCard}`} aria-labelledby="timeline-title">
          <div className={styles.timelineInner}>
            <div className="card-head">
              <h2 id="timeline-title" className="card-title">
                Agent timeline
              </h2>
              <span className="chip chip-sm tone-neutral">{view.rounds ? pluralise(view.rounds, "round") : live ? "In progress" : "—"}</span>
            </div>
            <AgentTimeline
              events={view.events}
              state={state}
              loopStatus={view.loopStatus}
              catalog={catalog}
              currency={currency}
              ruleCount={RULE_CATALOG.length}
              autoScroll={replay.playing || replay.following}
              reducedMotion={reducedMotion}
              onSelectOffer={setSelected}
            />
          </div>
        </section>
      </div>

      <div id="decide" className={styles.mid}>
        <section className={`card ${styles.actionCard}`} aria-label="Decision">
          {view.phase === "verified" && <ApprovalPanel view={view} catalog={catalog} busy={busy === "approve"} onSelectOffer={setSelected} onApprove={(name) => run("approve", "approve", { approvedBy: name }, () => "Bundle approved")} />}
          {showSettlement && (
            <SettlementPanel
              view={view}
              config={config}
              busy={busy}
              actions={{
                pay: () => run("pay", "pay", {}, () => "Order created"),
                capture: () => run("capture", "capture", {}, () => "Payment captured"),
                retryPayouts: () => run("payouts", "payouts", {}, (v) => (v.payouts?.status === "FAILED" ? null : "Payouts sent")),
                refund: () => run("refund", "refund", {}, () => "Buyer refunded"),
              }}
            />
          )}
          {view.phase === "failed" && <FailurePanel view={view} catalog={catalog} />}
          {live && (
            <div className={styles.working}>
              <span className="dot dot-live" aria-hidden />
              <div>
                <p className={styles.workingTitle}>{view.phase === "extracting" ? "Reading the licences" : view.phase === "proposing" ? "Choosing a bundle" : "Starting"}</p>
                <p className="small muted">The approval step appears here once the rules engine verifies a bundle. Nothing can be bought before that.</p>
              </div>
            </div>
          )}
        </section>
        <div className={styles.sideCol}>
        {view.analysis && (
          <section className={`card ${styles.summaryCard}`} aria-labelledby="summary-title">
            <div className="card-head">
              <h2 id="summary-title" className="card-title">
                Compliance summary
              </h2>
              <span className="small muted">Every figure is a price from an uploaded licence</span>
            </div>
            <ComplianceSummary analysis={view.analysis} catalog={catalog} currency={currency} verified={Boolean(view.bundle)} project={view.project} />
          </section>
        )}
        {!live && (
          <section className="card" aria-labelledby="ask-title">
            <div className="card-head">
              <h2 id="ask-title" className="card-title">
                Ask about this run
              </h2>
              <span className="small muted">Answers come only from this run&rsquo;s recorded facts</span>
            </div>
            <AskPanel runId={view.id} catalog={catalog} onSelectOffer={setSelected} suggestions={["Why were licences rejected?", "What did staying compliant cost?", "Who gets paid?"]} />
          </section>
        )}
        </div>
      </div>

      {view.analysis && (
        <section className={`card ${styles.matrixCard}`} aria-labelledby="matrix-title">
          <div className="card-head">
            <h2 id="matrix-title" className="card-title">
              Verification matrix
            </h2>
            <span className="small muted">Every candidate licence against every rule, from the rules engine&rsquo;s own results</span>
          </div>
          <VerificationMatrix analysis={view.analysis} requiredAssetIds={requiredAssetIds} catalog={catalog} state={state} currency={currency} selectedOfferId={selected} onSelectOffer={setSelected} />
        </section>
      )}

      <div className={styles.ledger}>
        <LedgerPanel events={view.events} chainValid={view.chainValid} catalog={catalog} cursor={replay.cursor} />
      </div>

      <EvidenceViewer
        offer={selectedOffer}
        document={selectedOffer ? view.documents.find((d) => d.id === selectedOffer.evidence[0]?.documentId) : undefined}
        evaluation={view.analysis?.evaluations.find((e) => e.offerId === selected)}
        catalog={catalog}
        state={selected ? state.offers[selected] : undefined}
        onClose={closeEvidence}
      />
    </div>
  );
}

function TheatreSkeleton() {
  return (
    <div className="container-wide" aria-busy="true" aria-label="Loading the run">
      <div style={{ padding: "32px 0 20px" }}>
        <div className="skeleton" style={{ width: 160, height: 12 }} />
        <div className="skeleton" style={{ width: "min(560px, 80%)", height: 44, marginTop: 12 }} />
        <div className="skeleton" style={{ width: 320, height: 24, marginTop: 16 }} />
      </div>
      <div className="skeleton" style={{ height: 54, borderRadius: 12 }} />
      <div className={styles.top}>
        <div className="skeleton" style={{ height: 560, borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 560, borderRadius: 14 }} />
      </div>
    </div>
  );
}

export function RunNotFound({ id }: { id: string }) {
  return (
    <div className={`container ${styles.empty}`}>
      <p className="eyebrow">Run {id.slice(0, 12)}</p>
      <h1 className={styles.emptyTitle}>This run does not exist on this server</h1>
      <p className={styles.emptyText}>The link may be mistyped, or the run was created on another server. Runs are stored by the server that created them.</p>
      <div className="row">
        <Link prefetch={false} href="/" className="btn btn-primary">
          Start a new run
        </Link>
        <Link prefetch={false} href="/dashboard" className="btn">
          <LayoutGrid aria-hidden /> Open the portfolio
        </Link>
      </div>
    </div>
  );
}
