import { randomUUID } from "node:crypto";
import { runProposeVerifyLoop, type LoopResult, type Proposer } from "../agent/loop";
import { analyzeRun, type RunAnalysis } from "../core/analysis";
import type { LicenseOffer, Project } from "../core/types";
import { extractOffer, type SourceDocument } from "../extraction/extract";
import type { ModelClient } from "../extraction/model";
import { Ledger, type LedgerEvent } from "../ledger/ledger";
import { approve, startCheckout, type Approval, type PayPalClient } from "../payments/checkout";
import type { SessionRepository } from "./persistence";
import { applyPayoutStatus, isFinalPayout, planPayouts, toPayoutItems, type PayoutSummary } from "../payments/payouts";
import type { CapturedOrder, CreatedOrder } from "../payments/paypal";

export type Phase = "created" | "extracting" | "proposing" | "verified" | "failed" | "approved" | "order_created" | "captured" | "settled";

export interface SessionInput {
  project: Project;
  requiredAssetIds: string[];
  documents: SourceDocument[];
  /** Where the run came from, for display. */
  meta?: { scenarioId?: string; brief?: string; /** "demo" replays recorded model output; "live" calls the model. */ runKind?: "demo" | "live" };
}

export interface Session {
  id: string;
  createdAt: string;
  /** The date offers were checked against (YYYY-MM-DD), fixed when the run starts. */
  runDate?: string;
  input: SessionInput;
  ledger: Ledger;
  phase: Phase;
  /** Why the run ended without a verified bundle, when it did. */
  failure?: string;
  candidates: LicenseOffer[];
  loop?: LoopResult;
  approval?: Approval;
  order?: CreatedOrder;
  capture?: CapturedOrder;
  payouts?: PayoutSummary;
  /** Epoch ms of the last payout status check, to avoid hammering PayPal. Not persisted. */
  payoutsCheckedAt?: number;
  /** Set by the store to persist the session after each change. Not persisted itself. */
  onChange?: () => void;
}

export interface Deps {
  model: ModelClient;
  proposer: Proposer;
  /** Absent when PayPal credentials are not configured. */
  payments?: Pick<PayPalClient, "createOrder" | "captureOrder"> & Partial<Pick<PayPalClient, "createPayout" | "getPayout">>;
  /** Replace licensor emails in order, so a demo can pay real Sandbox accounts. */
  payeeOverrides?: string[];
  today?: () => string;
  returnUrl?: (sessionId: string) => string;
  cancelUrl?: (sessionId: string) => string;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

const today = (deps: Deps) => (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();

export function createSession(input: SessionInput, ledger: Ledger = new Ledger()): Session {
  const { project, requiredAssetIds, documents } = input;
  if (!project.name.trim()) throw new SessionError("Project needs a name.");
  if (project.territories.length === 0) throw new SessionError("Project needs at least one territory.");
  if (!Number.isInteger(project.termMonths) || project.termMonths <= 0) throw new SessionError("Project term must be a whole number of months.");
  if (requiredAssetIds.length === 0) throw new SessionError("List at least one required asset.");
  if (documents.length === 0) throw new SessionError("Add at least one licence document.");
  if (documents.some((d) => !d.text.trim())) throw new SessionError("A licence document is empty.");
  if (new Set(documents.map((d) => d.id)).size !== documents.length) throw new SessionError("Licence document ids must be unique.");
  const uncovered = requiredAssetIds.filter((a) => !documents.some((d) => d.assetId === a));
  if (uncovered.length) throw new SessionError(`No licence document for: ${uncovered.join(", ")}.`);
  const session: Session = { id: randomUUID(), createdAt: new Date().toISOString(), input, ledger, phase: "created", candidates: [] };
  ledger.onAppend = () => session.onChange?.();
  return session;
}

const touch = (s: Session) => s.onChange?.();

/** Extract terms from every document, then run the propose-verify-revise loop. Runs once per session. */
export async function runPipeline(session: Session, deps: Deps): Promise<void> {
  if (session.phase !== "created") throw new SessionError(`Cannot run from phase "${session.phase}".`);
  session.phase = "extracting";
  session.runDate = today(deps);
  touch(session);

  for (const doc of session.input.documents) {
    const result = await extractOffer(deps.model, doc);
    if (result.offer) {
      session.candidates.push(result.offer);
      session.ledger.append("extracted", { documentId: doc.id, assetId: doc.assetId, offerId: result.offer.id, priceCents: result.offer.priceCents, terms: result.offer.terms, evidence: result.offer.evidence });
    } else {
      session.ledger.append("extraction_failed", { documentId: doc.id, assetId: doc.assetId, problems: result.problems });
    }
  }

  // No point asking the proposer when an asset has no readable licence at all.
  const unreadable = session.input.requiredAssetIds.filter((a) => !session.candidates.some((c) => c.assetId === a));
  if (unreadable.length) {
    session.phase = "failed";
    session.failure = `Could not read the licence terms for: ${unreadable.join(", ")}. See the ledger for details.`;
    touch(session);
    return;
  }

  session.phase = "proposing";
  touch(session);
  session.loop = await runProposeVerifyLoop({
    project: session.input.project,
    requiredAssetIds: session.input.requiredAssetIds,
    candidates: session.candidates,
    proposer: deps.proposer,
    ledger: session.ledger,
    verifyOptions: { today: today(deps) },
  });

  if (session.loop.status === "verified") {
    session.phase = "verified";
  } else {
    session.phase = "failed";
    session.failure =
      session.loop.status === "stalled"
        ? "No licence bundle in the uploaded documents satisfies the project's constraints."
        : "The agent ran out of attempts before finding a compliant bundle.";
  }
  touch(session);
}

/** A human signs off on exactly the verified bundle. */
export function approveSession(session: Session, approvedBy: string): Approval {
  if (session.phase !== "verified" || !session.loop?.bundle) throw new SessionError("Only a verified bundle can be approved.");
  if (!approvedBy.trim()) throw new SessionError("Approver name is required.");
  session.approval = approve(session.loop.bundle, approvedBy.trim());
  session.phase = "approved";
  touch(session);
  session.ledger.append("approved", { approvedBy: session.approval.approvedBy, bundleDigest: session.approval.bundleDigest });
  return session.approval;
}

/** Creates the PayPal Sandbox order through the gate, which re-verifies and checks the approval. */
export async function startPayment(session: Session, deps: Deps): Promise<CreatedOrder> {
  if (!deps.payments) throw new SessionError("PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  if (session.phase !== "approved" || !session.loop?.bundle) throw new SessionError("Approve the verified bundle before paying.");
  const order = await startCheckout(deps.payments, {
    project: session.input.project,
    requiredAssetIds: session.input.requiredAssetIds,
    bundle: session.loop.bundle,
    approval: session.approval,
    today: today(deps),
    idempotencyScope: session.id,
    returnUrl: deps.returnUrl?.(session.id),
    cancelUrl: deps.cancelUrl?.(session.id),
  });
  session.order = order;
  session.phase = "order_created";
  touch(session);
  session.ledger.append("order_created", { orderId: order.id, status: order.status });
  return order;
}

/**
 * Captures the payment once the buyer has approved the order at PayPal, then pays the creators.
 * A payout problem never undoes the capture: it is recorded and can be retried.
 */
export async function completePayment(session: Session, deps: Deps): Promise<CapturedOrder> {
  if (!deps.payments) throw new SessionError("PayPal is not configured.");
  if (session.phase !== "order_created" || !session.order) throw new SessionError("No PayPal order is waiting to be captured.");
  const captured = await deps.payments.captureOrder(session.order.id, `lg-capture-${session.id}`);
  session.capture = captured;
  session.phase = "captured";
  touch(session);
  session.ledger.append("captured", { orderId: captured.id, captureId: captured.captureId, amount: captured.amount });
  await settleCreators(session, deps);
  return captured;
}

/** Pay each licensor the price of their licence in one PayPal Payouts batch. Safe to call again after a failure. */
export async function settleCreators(session: Session, deps: Deps): Promise<PayoutSummary | undefined> {
  const bundle = session.loop?.bundle;
  if (!deps.payments?.createPayout || !bundle || !session.capture) return undefined;
  if (session.payouts && session.payouts.status !== "FAILED") return session.payouts;

  const plan = planPayouts(bundle.offers, session.input.documents, deps.payeeOverrides);
  if (plan.lines.length === 0) return undefined;

  const batchId = `lg-payout-${session.id}${session.payouts ? `-retry${Date.now().toString(36)}` : ""}`;
  const currency = plan.lines[0]!.currency;
  const totalCents = plan.lines.reduce((n, l) => n + l.amountCents, 0);
  const base = { batchId, totalCents, currency, createdAt: new Date().toISOString() };
  try {
    const created = await deps.payments.createPayout({ batchId, subject: "Licence payment via LicenseGraph", items: toPayoutItems(plan.lines, (l) => `Licence for ${l.assetId} (${session.input.project.name})`) });
    session.payouts = { ...base, batchId: created.batchId, status: created.status, lines: plan.lines.map((l) => ({ ...l, status: "PENDING" })) };
    session.phase = "settled";
    touch(session);
    session.ledger.append("payout_created", { batchId: created.batchId, status: created.status, totalCents, currency, lines: plan.lines.map((l) => ({ assetId: l.assetId, licensor: l.licensorName, amountCents: l.amountCents })) });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Payout failed";
    session.payouts = { ...base, status: "FAILED", lines: plan.lines.map((l) => ({ ...l, status: "FAILED" })), error };
    touch(session);
    session.ledger.append("payout_failed", { error: error.slice(0, 300) });
  }
  return session.payouts;
}

/** Ask PayPal how the payout batch is going. Throttled, and records the moment it reaches a final state. */
export async function refreshPayouts(session: Session, deps: Deps, now: () => number = Date.now): Promise<void> {
  const payouts = session.payouts;
  if (!payouts || payouts.status === "FAILED" || isFinalPayout(payouts.status) || !deps.payments?.getPayout) return;
  if (session.payoutsCheckedAt && now() - session.payoutsCheckedAt < 4_000) return;
  session.payoutsCheckedAt = now();
  try {
    session.payouts = applyPayoutStatus(payouts, await deps.payments.getPayout(payouts.batchId));
    touch(session);
    if (isFinalPayout(session.payouts.status)) session.ledger.append("payout_settled", { batchId: payouts.batchId, status: session.payouts.status, lines: session.payouts.lines.map((l) => ({ assetId: l.assetId, status: l.status })) });
  } catch {
    // A failed status check is not a failed payout; the next poll tries again.
  }
}

const maskEmail = (email: string) => {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(1, name.length - 2))}@${domain}`;
};

export interface SessionView {
  id: string;
  phase: Phase;
  createdAt: string;
  failure?: string;
  project: Project;
  meta?: SessionInput["meta"];
  /** Source licence text, so the UI can highlight the quotes that back each term. */
  documents: { id: string; assetId: string; text: string; licensorName?: string }[];
  candidates: LicenseOffer[];
  loopStatus?: LoopResult["status"];
  rounds?: number;
  bundle?: { offers: LicenseOffer[]; totalCents: number; currency: string };
  /** Every candidate checked against every rule, and the price-only comparison. */
  analysis?: RunAnalysis;
  approval?: Approval;
  order?: CreatedOrder;
  capture?: CapturedOrder;
  payouts?: Omit<PayoutSummary, "lines"> & { lines: (Omit<PayoutSummary["lines"][number], "email"> & { emailMasked: string })[] };
  events: LedgerEvent[];
  chainValid: boolean;
}

export function viewOf(session: Session): SessionView {
  const bundle = session.loop?.status === "verified" ? session.loop.bundle : undefined;
  const analysis = session.candidates.length
    ? analyzeRun({ project: session.input.project, requiredAssetIds: session.input.requiredAssetIds, candidates: session.candidates, chosenOfferIds: bundle?.offers.map((o) => o.id) ?? [], options: { today: session.runDate } })
    : undefined;
  return {
    id: session.id,
    phase: session.phase,
    createdAt: session.createdAt,
    failure: session.failure,
    project: session.input.project,
    meta: session.input.meta,
    documents: session.input.documents.map((d) => ({ id: d.id, assetId: d.assetId, text: d.text, licensorName: d.licensor?.name })),
    candidates: session.candidates,
    loopStatus: session.loop?.status,
    rounds: session.loop?.rounds,
    bundle: bundle && { offers: bundle.offers, totalCents: session.loop!.verdict!.totalCents, currency: bundle.offers[0]?.currency ?? "USD" },
    analysis,
    approval: session.approval,
    order: session.order,
    capture: session.capture,
    payouts: session.payouts && { ...session.payouts, lines: session.payouts.lines.map(({ email, ...rest }) => ({ ...rest, emailMasked: maskEmail(email) })) },
    events: session.ledger.events(),
    chainValid: session.ledger.verify(),
  };
}

const ACTIVE: Phase[] = ["created", "extracting", "proposing"];

/** Sessions with a size cap, optionally saved to disk so they survive a restart. */
export class SessionStore {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly maxSessions = 200,
    private readonly repo?: SessionRepository,
  ) {
    for (const s of repo?.loadAll() ?? []) this.attach(s);
  }

  private attach(s: Session) {
    this.sessions.set(s.id, s);
    s.onChange = () => {
      try {
        this.repo?.save(s);
      } catch {
        // Persistence is best effort; a full disk must not break a live run.
      }
    };
  }

  add(s: Session) {
    // Map keeps insertion order, so the first entries are the oldest. Never evict a run in progress.
    for (const [id, old] of this.sessions) {
      if (this.sessions.size < this.maxSessions) break;
      if (!ACTIVE.includes(old.phase)) this.sessions.delete(id);
    }
    this.attach(s);
    s.onChange?.();
    return s;
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  /** Newest first. */
  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Runs still reading licences or choosing a bundle. */
  activeCount() {
    return [...this.sessions.values()].filter((s) => ACTIVE.includes(s.phase)).length;
  }
}
