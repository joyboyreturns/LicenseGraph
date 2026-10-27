/**
 * "State as of event N": everything the run theatre draws (graph, step rail, banners) derived from
 * the first N ledger events. Pure, so the replay controller can scrub to any point and the same
 * function follows a live run when N is the latest event.
 */
import type { LedgerEvent, LedgerKind } from "@/src/ledger/chain";
import type { Phase } from "@/src/app-logic/session";
import type { Violation } from "@/src/core/types";
import { isLoopEvent } from "./rounds";

export type DocState = "queued" | "reading" | "read" | "unreadable";
export type OfferState = "hidden" | "candidate" | "proposed" | "rejected" | "chosen" | "alternative" | "ineligible";
export type AssetState = "open" | "proposed" | "rejected" | "covered";
export type LoopState = "idle" | "reading" | "proposing" | "verifying" | "rejected" | "verified" | "error" | "failed";
export type StepId = "read" | "propose" | "verify" | "approve" | "pay" | "settle" | "passport";
export type StepStatus = "todo" | "current" | "done" | "failed";

export const STEPS: { id: StepId; label: string; actor: string }[] = [
  { id: "read", label: "Read", actor: "Agent" },
  { id: "propose", label: "Propose", actor: "Agent" },
  { id: "verify", label: "Verify", actor: "Rules engine" },
  { id: "approve", label: "Approve", actor: "You" },
  { id: "pay", label: "Pay", actor: "PayPal" },
  { id: "settle", label: "Settle", actor: "PayPal Payouts" },
  { id: "passport", label: "Passport", actor: "Ledger" },
];

export interface RunStateInput {
  events: readonly LedgerEvent[];
  /** How many events have been applied (0 … events.length). Clamped. */
  cursor: number;
  documents: readonly { id: string; assetId: string }[];
  offers: readonly { id: string; assetId: string }[];
  requiredAssetIds: readonly string[];
  /** The session's real phase; used only when the cursor is at the latest event. */
  livePhase: Phase;
  /** Offers that fail a rule on their own (from the run analysis). */
  nonCompliant?: ReadonlySet<string>;
}

export interface OfferNote {
  proposedIn: number[];
  rejectedIn: number[];
  /** Violations naming this offer, latest round last. */
  violations: (Violation & { round: number })[];
}

export interface RunState {
  cursor: number;
  total: number;
  atEnd: boolean;
  /** The event that was applied last, if any. */
  current?: LedgerEvent;
  phase: Phase;
  loop: LoopState;
  round: number;
  docs: Record<string, DocState>;
  offers: Record<string, OfferState>;
  notes: Record<string, OfferNote>;
  assets: Record<string, AssetState>;
  activeProposal: string[];
  chosen: string[];
  /** The latest verifier decision, for the graph's verdict banner. */
  verdict?: { kind: "rejected"; round: number; violations: Violation[] } | { kind: "verified"; round: number; totalCents: number } | { kind: "error"; round: number; message: string };
  steps: Record<StepId, StepStatus>;
}

const ACTIVE_PHASES: Phase[] = ["created", "extracting", "proposing"];
export const isActivePhase = (p: Phase) => ACTIVE_PHASES.includes(p);

/** The phase the run was in right after `applied` events. */
export function phaseAt(applied: readonly Pick<LedgerEvent, "kind">[]): Phase {
  const has = (k: LedgerKind) => applied.some((e) => e.kind === k);
  if (has("payout_created")) return "settled";
  if (has("captured")) return "captured";
  if (has("order_created")) return "order_created";
  if (has("approved")) return "approved";
  if (has("verified")) return "verified";
  if (applied.some(isLoopEvent)) return "proposing";
  if (has("extracted") || has("extraction_failed")) return "extracting";
  return "created";
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const roundOf = (e: LedgerEvent, fallback: number) => (typeof e.payload.round === "number" ? e.payload.round : fallback);

export function deriveRunState(input: RunStateInput): RunState {
  const { events, documents, offers, requiredAssetIds, livePhase } = input;
  const total = events.length;
  const cursor = Math.max(0, Math.min(total, Math.floor(Number.isFinite(input.cursor) ? input.cursor : total)));
  const atEnd = cursor === total;
  const applied = events.slice(0, cursor);
  const phase: Phase = atEnd ? livePhase : phaseAt(applied);
  const has = (k: LedgerKind) => applied.some((e) => e.kind === k);

  // Reading
  const docs: Record<string, DocState> = Object.fromEntries(documents.map((d) => [d.id, "queued" as DocState]));
  const extractedOffers = new Set<string>();
  for (const e of applied) {
    const docId = String(e.payload.documentId ?? "");
    if (e.kind === "extracted") {
      if (docId) docs[docId] = "read";
      extractedOffers.add(String(e.payload.offerId ?? ""));
    } else if (e.kind === "extraction_failed") {
      docs[docId] = "unreadable";
    }
  }
  const loopStarted = applied.some(isLoopEvent);
  if (!loopStarted) {
    const next = events[cursor];
    if (!atEnd && next && (next.kind === "extracted" || next.kind === "extraction_failed")) {
      const id = String(next.payload.documentId ?? "");
      if (docs[id] === "queued") docs[id] = "reading";
    } else if (atEnd && (livePhase === "extracting" || livePhase === "created")) {
      const first = documents.find((d) => docs[d.id] === "queued");
      if (first && livePhase === "extracting") docs[first.id] = "reading";
    }
  }

  // The loop
  const notes: Record<string, OfferNote> = Object.fromEntries(offers.map((o) => [o.id, { proposedIn: [], rejectedIn: [], violations: [] } as OfferNote]));
  const note = (id: string) => (notes[id] ??= { proposedIn: [], rejectedIn: [], violations: [] });
  let round = 0;
  let activeProposal: string[] = [];
  let chosen: string[] = [];
  let lastLoop: LedgerEvent | undefined;
  let verdict: RunState["verdict"];
  let latestRejectedAssets = new Set<string>();
  for (const e of applied) {
    if (!isLoopEvent(e)) continue;
    lastLoop = e;
    const r = roundOf(e, round || 1);
    round = Math.max(round, r);
    if (e.kind === "proposed" || e.kind === "revised") {
      activeProposal = asStrings(e.payload.offerIds);
      for (const id of activeProposal) note(id).proposedIn.push(r);
      latestRejectedAssets = new Set();
    } else if (e.kind === "rejected") {
      const violations = (Array.isArray(e.payload.violations) ? e.payload.violations : []) as Violation[];
      latestRejectedAssets = new Set(violations.map((v) => v.assetId).filter((a): a is string => Boolean(a)));
      for (const v of violations) {
        if (!v.offerId) continue;
        const n = note(v.offerId);
        if (!n.rejectedIn.includes(r)) n.rejectedIn.push(r);
        n.violations.push({ ...v, round: r });
      }
      verdict = { kind: "rejected", round: r, violations };
      activeProposal = [];
    } else if (e.kind === "verified") {
      chosen = asStrings(e.payload.offerIds);
      verdict = { kind: "verified", round: r, totalCents: typeof e.payload.totalCents === "number" ? e.payload.totalCents : 0 };
      activeProposal = [];
    } else if (e.kind === "proposal_error") {
      verdict = { kind: "error", round: r, message: typeof e.payload.error === "string" ? e.payload.error : "Proposal could not be used." };
      activeProposal = [];
    }
  }

  let loop: LoopState;
  if (chosen.length) loop = "verified";
  else if (atEnd && livePhase === "failed") loop = "failed";
  else if (!lastLoop) loop = applied.length || (atEnd && livePhase === "extracting") ? "reading" : "idle";
  else if (lastLoop.kind === "proposed" || lastLoop.kind === "revised") loop = "verifying";
  else if (lastLoop.kind === "rejected") loop = atEnd && livePhase === "proposing" ? "proposing" : "rejected";
  else if (lastLoop.kind === "proposal_error") loop = atEnd && livePhase === "proposing" ? "proposing" : "error";
  else loop = "idle";
  if (loop === "idle" && atEnd && livePhase === "proposing") loop = "proposing";

  const concluded = loop === "verified" || loop === "failed";
  // A failed run's last proposal was never verified (it repeated a rejected bundle); nothing is pending.
  if (loop === "failed") activeProposal = [];
  const chosenSet = new Set(chosen);
  const offerStates: Record<string, OfferState> = {};
  for (const o of offers) {
    const n = note(o.id);
    let s: OfferState;
    if (!extractedOffers.has(o.id) && !(atEnd && !isActivePhase(livePhase))) s = "hidden";
    else if (chosenSet.has(o.id)) s = "chosen";
    else if (activeProposal.includes(o.id)) s = "proposed";
    else if (n.rejectedIn.length) s = "rejected";
    else if (concluded) s = input.nonCompliant?.has(o.id) ? "ineligible" : chosen.length ? "alternative" : "candidate";
    else s = "candidate";
    offerStates[o.id] = s;
  }

  const assets: Record<string, AssetState> = {};
  const offerAsset = new Map(offers.map((o) => [o.id, o.assetId]));
  const assetsOf = (ids: string[]) => new Set(ids.map((id) => offerAsset.get(id)).filter((a): a is string => Boolean(a)));
  const chosenAssets = assetsOf(chosen);
  const proposedAssets = assetsOf(activeProposal);
  for (const a of requiredAssetIds) {
    assets[a] = chosenAssets.has(a) ? "covered" : proposedAssets.has(a) ? "proposed" : latestRejectedAssets.has(a) && lastLoop?.kind === "rejected" ? "rejected" : "open";
  }

  // Step rail
  const failed = loop === "failed";
  const steps: Record<StepId, StepStatus> = { read: "todo", propose: "todo", verify: "todo", approve: "todo", pay: "todo", settle: "todo", passport: "todo" };
  const reading = phase === "created" || phase === "extracting";
  steps.read = reading ? "current" : failed && !loopStarted ? "failed" : "done";
  if (!reading) {
    if (chosen.length) {
      steps.propose = "done";
      steps.verify = "done";
    } else if (failed) {
      steps.propose = loopStarted ? "done" : "todo";
      steps.verify = loopStarted ? "failed" : "todo";
    } else if (!lastLoop || lastLoop.kind === "rejected" || lastLoop.kind === "proposal_error") {
      steps.propose = "current";
    } else {
      steps.propose = "done";
      steps.verify = "current";
    }
  }
  if (chosen.length) steps.approve = has("approved") ? "done" : "current";
  if (has("approved")) steps.pay = has("captured") ? "done" : "current";
  if (has("captured")) {
    const payoutEvents = applied.filter((e) => e.kind === "payout_created" || e.kind === "payout_failed" || e.kind === "payout_settled");
    const lastPayout = payoutEvents.at(-1);
    if (lastPayout?.kind === "payout_settled") steps.settle = lastPayout.payload.status === "SUCCESS" ? "done" : "failed";
    else if (lastPayout?.kind === "payout_failed") steps.settle = "failed";
    else steps.settle = "current";
    steps.passport = steps.settle === "current" ? "todo" : "done";
  }

  return {
    cursor,
    total,
    atEnd,
    current: applied.at(-1),
    phase,
    loop,
    round,
    docs,
    offers: offerStates,
    notes,
    assets,
    activeProposal,
    chosen,
    verdict,
    steps,
  };
}

/** How long the replay dwells on an event at 1× speed, in milliseconds. */
export function eventDwell(kind: LedgerKind | string): number {
  switch (kind) {
    case "extracted":
      return 480;
    case "extraction_failed":
      return 800;
    case "proposed":
    case "revised":
      return 1300;
    case "rejected":
      return 2000;
    case "verified":
      return 1800;
    case "proposal_error":
      return 1200;
    default:
      return 900;
  }
}

/** Total replay length at a speed, for the controller's time label. */
export function replayDuration(events: readonly Pick<LedgerEvent, "kind">[], speed = 1): number {
  return events.reduce((n, e) => n + eventDwell(e.kind), 0) / Math.max(0.25, speed);
}

export interface ReplayMarker {
  index: number;
  kind: "rejected" | "verified" | "approved" | "captured";
  label: string;
}

/** Points worth marking on the scrubber: each verdict and the payment milestones. */
export function replayMarkers(events: readonly LedgerEvent[]): ReplayMarker[] {
  const out: ReplayMarker[] = [];
  events.forEach((e, i) => {
    if (e.kind === "rejected") out.push({ index: i + 1, kind: "rejected", label: `Round ${roundOf(e, 1)} rejected` });
    else if (e.kind === "verified") out.push({ index: i + 1, kind: "verified", label: `Verified in round ${roundOf(e, 1)}` });
    else if (e.kind === "approved") out.push({ index: i + 1, kind: "approved", label: "Approved" });
    else if (e.kind === "captured") out.push({ index: i + 1, kind: "captured", label: "Payment captured" });
  });
  return out;
}
