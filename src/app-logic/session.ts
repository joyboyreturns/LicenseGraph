import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { runProposeVerifyLoop, type LoopResult, type Proposer } from "../agent/loop";
import { analyzeRun, type RunAnalysis } from "../core/analysis";
import type { LicenseOffer, Project } from "../core/types";
import { extractOffer, type SourceDocument } from "../extraction/extract";
import type { ModelClient } from "../extraction/model";
import { Ledger, type LedgerEvent } from "../ledger/ledger";
import { approve, startCheckout, type Approval, type PayPalClient } from "../payments/checkout";
import type { SessionRepository } from "./persistence";
import { applyPayoutStatus, isFinalPayout, planPayouts, toPayoutItems, type PayoutSummary } from "../payments/payouts";
import type { CapturedOrder, CreatedOrder, RefundedCapture } from "../payments/paypal";
import { centsToValue } from "../payments/paypal";
import { paymentRequestId } from "../payments/request-id";
import { isIsoDate } from "../core/dates";
import { minimumCompliantCost } from "../core/optimizer";
import { checkMandate, type Mandate } from "../core/mandate";
import { finePrint } from "../core/fine-print";

export type Phase = "created" | "extracting" | "proposing" | "verified" | "failed" | "approved" | "order_created" | "captured" | "settled" | "refunded";

export interface SessionInput {
  project: Project;
  requiredAssetIds: string[];
  documents: SourceDocument[];
  /** Where the run came from, for display. */
  meta?: { scenarioId?: string; brief?: string; /** "demo" replays recorded model output; "live" calls the model. */ runKind?: "demo" | "live"; /** Started by an AI agent through the API; a person must take control before anything can be approved or paid. */ startedBy?: "agent"; /** The run whose gap requests this one answers, with a licensor's revised licence added. */ revisedFrom?: string; /** The spending cap an agent says its person gave it. */ mandate?: Mandate };
}

export interface Session {
  id: string;
  /** The anonymous browser that created the run; only it may approve, pay or list it. */
  ownerId?: string;
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
  /** Assets whose creator could not be paid (no payout email), known once a bundle is verified. Payment re-checks it either way. */
  payoutBlockedAssets?: string[];
  /** Who would be paid what once the payment is captured, known once a bundle is verified. Addresses are masked; only the plan is kept. */
  payoutPreview?: PayoutPreviewLine[];
  /** The buyer's money was returned because the creators could not be paid. */
  refund?: { id: string; status: string; amount: { currency: string; value: string }; at: string };
  /** Present until a person takes over an agent-started run: only a hash of the one-time claim token is kept. */
  claim?: { tokenHash: string; expiresAt: string };
  /** Which payment backend took this run's order, so the passport can say so truthfully. */
  paymentsMode?: "paypal-sandbox" | "simulator";
  /** Epoch ms of the last payout status check, to avoid hammering PayPal. Not persisted. */
  payoutsCheckedAt?: number;
  /** Set by the store to persist the session after each change. Not persisted itself. */
  onChange?: () => void;
}

export interface Deps {
  model: ModelClient;
  proposer: Proposer;
  /** Absent when PayPal credentials are not configured. */
  payments?: Pick<PayPalClient, "createOrder" | "captureOrder"> & Partial<Pick<PayPalClient, "createPayout" | "getPayout" | "refundCapture" | "verifyWebhookSignature">>;
  /** Replace licensor emails in order, so a demo can pay real Sandbox accounts. */
  payeeOverrides?: string[];
  /** Which payment backend `payments` is. */
  paymentsMode?: "paypal-sandbox" | "simulator";
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
  if (project.budgetCents !== undefined && (!Number.isSafeInteger(project.budgetCents) || project.budgetCents < 0)) throw new SessionError("Budget must be non-negative safe integer cents.");
  if (project.endDate !== undefined && !isIsoDate(project.endDate)) throw new SessionError("Project end date must be a real calendar date.");
  if (requiredAssetIds.length === 0) throw new SessionError("List at least one required asset.");
  if (requiredAssetIds.some((id) => !id.trim()) || new Set(requiredAssetIds).size !== requiredAssetIds.length) throw new SessionError("Required asset ids must be non-empty and unique.");
  if (documents.length === 0) throw new SessionError("Add at least one licence document.");
  if (documents.some((d) => !d.text.trim())) throw new SessionError("A licence document is empty.");
  if (new Set(documents.map((d) => d.id)).size !== documents.length) throw new SessionError("Licence document ids must be unique.");
  const uncovered = requiredAssetIds.filter((a) => !documents.some((d) => d.assetId === a));
  if (uncovered.length) throw new SessionError(`No licence document for: ${uncovered.join(", ")}.`);
  const session: Session = { id: randomUUID(), createdAt: new Date().toISOString(), input: structuredClone(input), ledger, phase: "created", candidates: [] };
  ledger.onAppend = () => session.onChange?.();
  return session;
}

const touch = (s: Session) => s.onChange?.();

const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Hand an agent-started run to people. The run gets an owner id no browser holds, so neither the agent
 * nor anyone else can approve or pay it, and a one-time token that is returned once and stored only as
 * a hash. Whoever presents the token (by a deliberate click, not a link preview) becomes the owner.
 */
export function reserveForPerson(session: Session, now: Date = new Date()): { token: string; expiresAt: string } {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
  session.ownerId = `agent-${randomUUID()}`;
  session.claim = { tokenHash: hashToken(token), expiresAt };
  session.input.meta = { ...session.input.meta, startedBy: "agent" };
  touch(session);
  return { token, expiresAt };
}

/** A person takes control of an agent-started run. The token works once; success is written to the ledger. */
export function claimSession(session: Session, token: string, ownerId: string, now: Date = new Date()): void {
  const claim = session.claim;
  if (!claim) throw new SessionError("This run is not waiting for a person to take control.");
  if (Date.parse(claim.expiresAt) < now.getTime()) throw new SessionError("This link has expired. Ask the agent to start the purchase again.");
  const given = Buffer.from(hashToken(token));
  const expected = Buffer.from(claim.tokenHash);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new SessionError("This link is not valid.");
  session.ownerId = ownerId;
  session.claim = undefined;
  touch(session);
  session.ledger.append("handed_over", { startedBy: "agent" });
}

// Join duplicate requests while an external operation is pending. A rejected request releases
// the lock so the owner can retry with the same durable PayPal idempotency key.
function singleFlight<T>(pending: WeakMap<Session, Promise<T>>, session: Session, work: () => Promise<T>): Promise<T> {
  const existing = pending.get(session);
  if (existing) return existing;
  const result = Promise.resolve().then(work).finally(() => pending.delete(session));
  pending.set(session, result);
  return result;
}
const ordersInFlight = new WeakMap<Session, Promise<CreatedOrder>>();
const capturesInFlight = new WeakMap<Session, Promise<CapturedOrder>>();
const payoutsInFlight = new WeakMap<Session, Promise<PayoutSummary | undefined>>();
const refundsInFlight = new WeakMap<Session, Promise<RefundedCapture>>();

const EXTRACTION_CONCURRENCY = 3;

/** At most `limit` of the given jobs run at once; the rest wait their turn. */
export function createGate(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(job: () => Promise<T>): Promise<T> => {
    // A finished job hands its place straight to the next waiter, so the count never dips and no newcomer can jump in.
    if (running < limit) running++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> => p.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));

/** Extract terms from every document, then run the propose-verify-revise loop. Runs once per session. */
export async function runPipeline(session: Session, deps: Deps, carried?: { fromRunId: string; offers: LicenseOffer[] }): Promise<void> {
  if (session.phase !== "created") throw new SessionError(`Cannot run from phase "${session.phase}".`);
  session.phase = "extracting";
  session.runDate = today(deps);
  touch(session);

  // A revised run does not read again what the run it answers already read: the same licence text gives the same terms.
  const carriedByDocument = new Map((carried?.offers ?? []).map((o) => [o.evidence[0]?.documentId, o]));
  const isCarried = (doc: SourceDocument) => {
    const earlier = carriedByDocument.get(doc.id);
    return earlier !== undefined && earlier.assetId === doc.assetId;
  };
  // Licences are read a few at a time (the model client paces its own requests), but recorded in document order,
  // so the ledger reads the same whether the model is fast or slow.
  const gate = createGate(EXTRACTION_CONCURRENCY);
  const reading = session.input.documents.map((doc) => (isCarried(doc) ? undefined : settle(gate(() => extractOffer(deps.model, doc)))));
  for (const [i, doc] of session.input.documents.entries()) {
    const earlier = carriedByDocument.get(doc.id);
    if (earlier && isCarried(doc)) {
      session.candidates.push(structuredClone(earlier));
      session.ledger.append("extracted", { documentId: doc.id, assetId: doc.assetId, offerId: earlier.id, priceCents: earlier.priceCents, terms: earlier.terms, evidence: earlier.evidence, carriedFromRun: carried!.fromRunId });
      continue;
    }
    const outcome = await reading[i]!;
    if (!outcome.ok) throw outcome.error;
    const result = outcome.value;
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

  // No point asking the proposer when the exact cost check proves some asset has no compliant offer: no bundle can pass,
  // and a slow model would spend rounds finding that out. The run ends at once and says what to ask each licensor.
  const options = { today: session.runDate };
  const { uncoveredAssets } = minimumCompliantCost(session.input.project, session.input.requiredAssetIds, session.candidates, options);
  if (uncoveredAssets.length) {
    session.phase = "failed";
    session.failure = `No licence on offer meets every requirement for: ${uncoveredAssets.join(", ")}. The agent was not asked to propose a bundle, because the independent cost check proves none can pass. See what to ask each licensor.`;
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
    verifyOptions: { today: session.runDate },
  });

  if (session.loop.status === "verified") {
    session.phase = "verified";
    recordMandateCheck(session);
    session.payoutBlockedAssets = payoutBlockers(session, deps);
    session.payoutPreview = payoutPreviewOf(session, deps);
  } else {
    session.phase = "failed";
    const frontier = minimumCompliantCost(session.input.project, session.input.requiredAssetIds, session.candidates, { today: session.runDate });
    session.failure = frontier.plans.some((p) => p.budgetShortfallCents === 0)
      ? "The agent stopped before selecting an available compliant bundle. See the independent cost check for the available choices."
      : session.loop.status === "stalled"
        ? "No licence bundle in the uploaded documents satisfies the project's constraints. See the independent cost check for missing rights or a budget shortfall."
        : "The agent ran out of attempts before finding a compliant bundle.";
  }
  touch(session);
}

/** How many clauses outside the rules engine's checks the approval screen put in front of the person, counted from the bought licences' own text. */
function finePrintShown(session: Session): number {
  const byId = new Map(session.input.documents.map((d) => [d.id, d.text]));
  return (session.loop?.bundle?.offers ?? []).reduce((n, o) => {
    const text = byId.get(o.evidence[0]?.documentId ?? "");
    return n + (text ? finePrint(text).length : 0);
  }, 0);
}

export interface PayoutPreviewLine {
  assetId: string;
  licensorName: string;
  emailMasked: string;
  amountCents: number;
  currency: string;
}

/** The payout plan for the verified bundle, so the buyer sees who receives what before approving. Empty where payouts do not happen. */
function payoutPreviewOf(session: Session, deps: Deps): PayoutPreviewLine[] {
  const bundle = session.loop?.bundle;
  if (!bundle || !deps.payments?.createPayout) return [];
  return planPayouts(bundle.offers, session.input.documents, deps.payeeOverrides).lines.map((l) => ({ assetId: l.assetId, licensorName: l.licensorName, emailMasked: maskEmail(l.email), amountCents: l.amountCents, currency: l.currency }));
}

/** An agent that stated a spending cap has the verified bundle checked against it; the result is written to the ledger for the person who approves. */
function recordMandateCheck(session: Session): void {
  const mandate = session.input.meta?.mandate;
  const bundle = session.loop?.bundle;
  const total = session.loop?.verdict?.totalCents;
  if (!mandate || !bundle || total === undefined) return;
  const currency = bundle.offers[0]?.currency ?? "USD";
  const check = checkMandate(mandate, { totalCents: total, currency });
  session.ledger.append("mandate_checked", { ...check, maxTotalCents: mandate.maxTotalCents, currency: mandate.currency, totalCents: total, ...(mandate.note ? { note: mandate.note } : {}) });
}

/**
 * Assets in the verified bundle whose creator cannot be paid. Only meaningful where payouts happen at
 * all; checked before an order is created, so a buyer is never charged for a purchase that cannot settle.
 */
export function payoutBlockers(session: Session, deps: Deps): string[] {
  const bundle = session.loop?.bundle;
  if (!bundle || !deps.payments?.createPayout) return [];
  return [...new Set(planPayouts(bundle.offers, session.input.documents, deps.payeeOverrides).unpaid.map((u) => u.assetId))];
}

/** A human signs off on exactly the verified bundle. */
export function approveSession(session: Session, approvedBy: string): Approval {
  if (session.phase !== "verified" || !session.loop?.bundle) throw new SessionError("Only a verified bundle can be approved.");
  if (!approvedBy.trim()) throw new SessionError("Approver name is required.");
  session.approval = approve(session.loop.bundle, approvedBy.trim());
  session.phase = "approved";
  touch(session);
  session.ledger.append("approved", { approvedBy: session.approval.approvedBy, bundleDigest: session.approval.bundleDigest, finePrintShown: finePrintShown(session) });
  return session.approval;
}

/** Creates the PayPal Sandbox order through the gate, which re-verifies and checks the approval. */
export function startPayment(session: Session, deps: Deps): Promise<CreatedOrder> {
  return singleFlight(ordersInFlight, session, () => startPaymentOnce(session, deps));
}

async function startPaymentOnce(session: Session, deps: Deps): Promise<CreatedOrder> {
  if (!deps.payments) throw new SessionError("PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
  if (session.phase !== "approved" || !session.loop?.bundle) throw new SessionError("Approve the verified bundle before paying.");
  const blocked = payoutBlockers(session, deps);
  if (blocked.length) throw new SessionError(`These creators cannot be paid because they have no payout email: ${blocked.join(", ")}. Nothing was charged. Start a new run and give each licensor a payout email.`);
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
  session.paymentsMode = deps.paymentsMode ?? "paypal-sandbox";
  session.phase = "order_created";
  touch(session);
  session.ledger.append("order_created", { orderId: order.id, status: order.status });
  return order;
}

/**
 * Captures the payment once the buyer has approved the order at PayPal, then pays the creators.
 * A payout problem never undoes the capture: it is recorded and can be retried.
 */
export function completePayment(session: Session, deps: Deps): Promise<CapturedOrder> {
  return singleFlight(capturesInFlight, session, () => completePaymentOnce(session, deps));
}

async function completePaymentOnce(session: Session, deps: Deps): Promise<CapturedOrder> {
  if (!deps.payments) throw new SessionError("PayPal is not configured.");
  if (session.phase !== "order_created" || !session.order) throw new SessionError("No PayPal order is waiting to be captured.");
  const captured = await deps.payments.captureOrder(session.order.id, paymentRequestId("capture", session.id));
  const bundle = session.loop?.bundle;
  const total = bundle?.offers.reduce((n, o) => n + o.priceCents, 0);
  if (!bundle || total === undefined || captured.id !== session.order.id || captured.status !== "COMPLETED" || !captured.captureId || captured.amount.currency !== bundle.offers[0]?.currency || captured.amount.value !== centsToValue(total)) {
    // Money may already have moved at PayPal, so the refusal is written to the ledger: the buyer and the owner can see it.
    session.ledger.append("capture_mismatch", { orderId: captured.id, captureId: captured.captureId ?? null, status: captured.status, amount: captured.amount ?? null, expectedCents: total ?? null, expectedCurrency: bundle?.offers[0]?.currency ?? null });
    throw new SessionError("Payment is not a completed capture for the approved order, currency and amount. No creator payouts were sent.");
  }
  session.capture = captured;
  session.phase = "captured";
  touch(session);
  session.ledger.append("captured", { orderId: captured.id, captureId: captured.captureId, amount: captured.amount });
  await settleCreators(session, deps);
  return captured;
}

/** Pay each licensor the price of their licence in one PayPal Payouts batch. Safe to call again after a failure. */
export function settleCreators(session: Session, deps: Deps): Promise<PayoutSummary | undefined> {
  return singleFlight(payoutsInFlight, session, () => settleCreatorsOnce(session, deps));
}

async function settleCreatorsOnce(session: Session, deps: Deps): Promise<PayoutSummary | undefined> {
  const bundle = session.loop?.bundle;
  if (session.phase === "refunded") return session.payouts; // the buyer was refunded; paying creators now would pay twice
  if (!deps.payments?.createPayout || !bundle || !session.capture) return undefined;
  if (session.payouts && session.payouts.status !== "FAILED") return session.payouts;
  const previous = session.payouts;

  const plan = planPayouts(bundle.offers, session.input.documents, deps.payeeOverrides);

  // A timeout can mean PayPal accepted the batch but the response was lost. Never change this
  // key on retry: a new key could pay every creator a second time, including after a restart.
  const batchId = paymentRequestId("payout", session.id);
  const currency = bundle.offers[0]!.currency;
  const totalCents = plan.lines.reduce((n, l) => n + l.amountCents, 0);
  const base = { batchId, totalCents, currency, createdAt: session.payouts?.createdAt ?? new Date().toISOString() };
  try {
    if (plan.unpaid.length) throw new SessionError(`No payout recipient for: ${plan.unpaid.map((l) => l.assetId).join(", ")}. No payouts were sent.`);
    if (Date.now() - Date.parse(base.createdAt) > 29 * 24 * 60 * 60 * 1000) throw new SessionError("Payout retry window expired. Reconcile the original batch with PayPal before sending any further payment.");
    const payload = toPayoutItems(plan.lines, (l) => `Licence for ${l.assetId} (${session.input.project.name})`);
    if (session.payouts && JSON.stringify(payload) !== JSON.stringify(toPayoutItems(session.payouts.lines, (l) => `Licence for ${l.assetId} (${session.input.project.name})`))) throw new SessionError("Payout recipients or amounts changed. Reconcile the original batch before retrying.");
    // Save the ambiguous state before I/O. A restart after PayPal accepts the request must
    // still offer a retry of this same key rather than forget the attempt ever happened.
    session.payouts = { ...base, status: "FAILED", lines: plan.lines.map((l) => ({ ...l, status: "PENDING" })), error: "Payout submission awaiting confirmation. Retry to reconcile the original batch." };
    touch(session);
    const created = await deps.payments.createPayout({ batchId, subject: "Licence payment via LicenseGraph", items: payload });
    session.payouts = { ...base, notSent: undefined, batchId: created.batchId, status: created.status === "SUCCESS" ? "PROCESSING" : created.status, lines: plan.lines.map((l) => ({ ...l, status: "PENDING" })) };
    touch(session);
    session.ledger.append("payout_created", { batchId: created.batchId, status: created.status, totalCents, currency, lines: plan.lines.map((l) => ({ assetId: l.assetId, licensor: l.licensorName, amountCents: l.amountCents })) });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Payout failed";
    // Certain only when the batch was never sent: refused before the request, or rejected with a client error
    // (4xx), and no earlier attempt could have been accepted. A timeout or a duplicate-batch answer is not certain.
    const neverSent = (e instanceof SessionError || /failed: 4\d\d\b/.test(error)) && !/BATCH_ID_ALREADY_EXISTS/.test(error) && (!previous || previous.notSent === true);
    session.payouts = { ...(previous ?? { ...base, lines: plan.lines.map((l) => ({ ...l, status: "FAILED" })) }), status: "FAILED", error, notSent: neverSent };
    touch(session);
    session.ledger.append("payout_failed", { error: error.slice(0, 300) });
  }
  return session.payouts;
}

/**
 * Why a captured payment cannot be refunded, or undefined when it can. A refund is allowed only when
 * it is certain that no creator was paid, because refunding the buyer after paying creators would
 * lose the money twice. An unsure failure (a timeout, say) has to be reconciled first.
 */
export function refundBlockedReason(session: Session): string | undefined {
  if (session.phase === "refunded") return "This purchase has already been refunded.";
  if (session.phase !== "captured" || !session.capture) return "Only a captured payment whose creators have not been paid can be refunded.";
  const p = session.payouts;
  if (!p) return undefined;
  if ((p.status === "DENIED" || p.status === "CANCELED") && p.lines.every((l) => l.status !== "SUCCESS")) return undefined;
  if (p.status === "FAILED" && p.notSent === true) return undefined;
  return "The creator payouts may already have been sent. Reconcile the batch with PayPal first; refunding now could pay out twice.";
}

/** Resolves once any refund this server has started for the run has been recorded. */
export async function refundSettled(session: Session): Promise<void> {
  await refundsInFlight.get(session)?.catch(() => undefined);
}

/** Return the buyer's money for a run whose creators could not be paid. Idempotent at PayPal; recorded in the ledger. */
export function refundPurchase(session: Session, deps: Deps): Promise<RefundedCapture> {
  return singleFlight(refundsInFlight, session, () => refundPurchaseOnce(session, deps));
}

async function refundPurchaseOnce(session: Session, deps: Deps): Promise<RefundedCapture> {
  if (!deps.payments?.refundCapture) throw new SessionError("Refunds are not available on this payment rail.");
  const blocked = refundBlockedReason(session);
  if (blocked) throw new SessionError(blocked);
  const refund = await deps.payments.refundCapture(session.capture!.captureId, paymentRequestId("refund", session.id));
  // PayPal's answer to a full refund normally has no amount; it is the captured amount.
  session.refund = { id: refund.id, status: refund.status, amount: refund.amount ?? session.capture!.amount, at: new Date().toISOString() };
  session.phase = "refunded";
  touch(session);
  session.ledger.append("refunded", { refundId: refund.id, captureId: session.capture!.captureId, amount: session.refund.amount, reason: session.payouts ? "creator payouts could not be sent" : "no creator payout was sent" });
  return refund;
}

/** Ask PayPal how the payout batch is going. Throttled, and records the moment it reaches a final state. */
export async function refreshPayouts(session: Session, deps: Deps, now: () => number = Date.now): Promise<void> {
  const payouts = session.payouts;
  if (!payouts || payouts.status === "FAILED" || isFinalPayout(payouts.status) || !deps.payments?.getPayout) return;
  if (session.payoutsCheckedAt && now() - session.payoutsCheckedAt < 4_000) return;
  session.payoutsCheckedAt = now();
  try {
    session.payouts = applyPayoutStatus(payouts, await deps.payments.getPayout(payouts.batchId));
    if (session.payouts.status === "SUCCESS") session.phase = "settled";
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
  /** The date offers were checked against when the run started (YYYY-MM-DD). */
  runDate?: string;
  failure?: string;
  /** An agent started this run and no person has taken control yet, so it cannot be approved or paid. */
  awaitingPerson?: boolean;
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
  refund?: Session["refund"];
  /** The captured payment can be returned to the buyer: creators were certainly not paid. */
  canRefund?: boolean;
  /** Assets whose creator has no payout email, so this purchase cannot be paid until a new run supplies one. */
  payoutBlockedAssets?: string[];
  /** Who would be paid what after capture (addresses masked). Absent when payouts are not available or the run is not verified. */
  payoutPreview?: PayoutPreviewLine[];
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
    runDate: session.runDate,
    failure: session.failure,
    awaitingPerson: session.claim ? true : undefined,
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
    refund: session.refund,
    canRefund: session.capture ? refundBlockedReason(session) === undefined : undefined,
    payoutBlockedAssets: session.payoutBlockedAssets?.length ? session.payoutBlockedAssets : undefined,
    payoutPreview: session.payoutPreview?.length ? session.payoutPreview : undefined,
    payouts: session.payouts && { ...session.payouts, lines: session.payouts.lines.map(({ email, ...rest }) => ({ ...rest, emailMasked: maskEmail(email) })) },
    events: session.ledger.events(),
    chainValid: session.ledger.verify(),
  };
}

const ACTIVE: Phase[] = ["created", "extracting", "proposing"];
const EVICTABLE: Phase[] = ["failed", "verified", "settled", "refunded"];

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
    // Only runs that nothing more can happen to are dropped; a run with money in flight (approved, order
    // created, captured) stays in memory so the buyer's return from PayPal and any payout retry still work.
    for (const [id, old] of this.sessions) {
      if (this.sessions.size < this.maxSessions) break;
      if (EVICTABLE.includes(old.phase)) this.sessions.delete(id);
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
