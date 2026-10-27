import { randomUUID } from "node:crypto";
import { runProposeVerifyLoop, type LoopResult, type Proposer } from "../agent/loop";
import type { LicenseOffer, Project } from "../core/types";
import { extractOffer, type SourceDocument } from "../extraction/extract";
import type { ModelClient } from "../extraction/model";
import { Ledger, type LedgerEvent } from "../ledger/ledger";
import { approve, startCheckout, type Approval, type PayPalClient } from "../payments/checkout";
import type { CapturedOrder, CreatedOrder } from "../payments/paypal";

export type Phase = "created" | "extracting" | "proposing" | "verified" | "failed" | "approved" | "order_created" | "captured";

export interface SessionInput {
  project: Project;
  requiredAssetIds: string[];
  documents: SourceDocument[];
}

export interface Session {
  id: string;
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
}

export interface Deps {
  model: ModelClient;
  proposer: Proposer;
  /** Absent when PayPal credentials are not configured. */
  payments?: Pick<PayPalClient, "createOrder" | "captureOrder">;
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
  return { id: randomUUID(), input, ledger, phase: "created", candidates: [] };
}

/** Extract terms from every document, then run the propose-verify-revise loop. Runs once per session. */
export async function runPipeline(session: Session, deps: Deps): Promise<void> {
  if (session.phase !== "created") throw new SessionError(`Cannot run from phase "${session.phase}".`);
  session.phase = "extracting";

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
    return;
  }

  session.phase = "proposing";
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
}

/** A human signs off on exactly the verified bundle. */
export function approveSession(session: Session, approvedBy: string): Approval {
  if (session.phase !== "verified" || !session.loop?.bundle) throw new SessionError("Only a verified bundle can be approved.");
  if (!approvedBy.trim()) throw new SessionError("Approver name is required.");
  session.approval = approve(session.loop.bundle, approvedBy.trim());
  session.phase = "approved";
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
  session.ledger.append("order_created", { orderId: order.id, status: order.status });
  return order;
}

/** Captures the payment once the buyer has approved the order at PayPal. */
export async function completePayment(session: Session, deps: Deps): Promise<CapturedOrder> {
  if (!deps.payments) throw new SessionError("PayPal is not configured.");
  if (session.phase !== "order_created" || !session.order) throw new SessionError("No PayPal order is waiting to be captured.");
  const captured = await deps.payments.captureOrder(session.order.id, `lg-capture-${session.id}`);
  session.capture = captured;
  session.phase = "captured";
  session.ledger.append("captured", { orderId: captured.id, captureId: captured.captureId, amount: captured.amount });
  return captured;
}

export interface SessionView {
  id: string;
  phase: Phase;
  failure?: string;
  project: Project;
  candidates: LicenseOffer[];
  loopStatus?: LoopResult["status"];
  bundle?: { offers: LicenseOffer[]; totalCents: number; currency: string };
  approval?: Approval;
  order?: CreatedOrder;
  capture?: CapturedOrder;
  events: LedgerEvent[];
  chainValid: boolean;
}

export function viewOf(session: Session): SessionView {
  const bundle = session.loop?.status === "verified" ? session.loop.bundle : undefined;
  return {
    id: session.id,
    phase: session.phase,
    failure: session.failure,
    project: session.input.project,
    candidates: session.candidates,
    loopStatus: session.loop?.status,
    bundle: bundle && { offers: bundle.offers, totalCents: session.loop!.verdict!.totalCents, currency: bundle.offers[0]?.currency ?? "USD" },
    approval: session.approval,
    order: session.order,
    capture: session.capture,
    events: session.ledger.events(),
    chainValid: session.ledger.verify(),
  };
}

const ACTIVE: Phase[] = ["created", "extracting", "proposing"];

/** In-memory sessions with a size cap, so a long-running or public server cannot grow without bound. */
export class SessionStore {
  private sessions = new Map<string, Session>();

  constructor(private readonly maxSessions = 200) {}

  add(s: Session) {
    // Map keeps insertion order, so the first entries are the oldest. Never evict a run in progress.
    for (const [id, old] of this.sessions) {
      if (this.sessions.size < this.maxSessions) break;
      if (!ACTIVE.includes(old.phase)) this.sessions.delete(id);
    }
    this.sessions.set(s.id, s);
    return s;
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  /** Runs still reading licences or choosing a bundle. */
  activeCount() {
    return [...this.sessions.values()].filter((s) => ACTIVE.includes(s.phase)).length;
  }
}
