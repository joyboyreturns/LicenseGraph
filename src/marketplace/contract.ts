import { z } from "zod";
import { sessionInputSchema } from "../server/session-input";
import { disputeSubmission, licensorSubmission, marketplaceOfferSchema } from "./types";

/**
 * The private marketplace's HTTP contract: one schema per request body and response, each named so the OpenAPI
 * document can reference it. The handlers parse requests with these same schemas, and the integration suite parses
 * real responses with them, so a drift in either direction fails a test.
 */
const uuid = z.uuid();
const named = <T extends z.ZodType>(id: string, schema: T, description?: string) => schema.meta({ id, ...(description ? { description } : {}) });

// ---- requests -------------------------------------------------------------------------------------------------
export const Req = {
  LicensorSubmission: named("LicensorSubmission", licensorSubmission, "Identity and rights evidence for staff review. Review records a decision; it does not certify copyright ownership."),
  OfferSubmission: named("OfferSubmission", z.object({ offer: marketplaceOfferSchema, document: sessionInputSchema.shape.documents.element, existingId: uuid.optional().describe("Submit a new version of this offer instead of a new offer.") }).strict(),
    "Every stated term, and the price, needs its own evidence entry whose quote is located in the source text at start..end."),
  CatalogRun: named("CatalogRun", z.object({
    project: sessionInputSchema.shape.project, requiredAssetIds: sessionInputSchema.shape.requiredAssetIds,
    offerRefs: z.array(z.object({ id: uuid, version: z.number().int().positive() }).strict()).min(1).max(12), handoff: z.boolean().optional().describe("An agent starts the run for a person; the response carries a one-time claim link."),
  }).strict(), "Start a run from reviewed marketplace offers."),
  DisputeSubmission: named("DisputeSubmission", disputeSubmission),
  ShareRequest: named("ShareRequest", z.object({ kind: z.enum(["receipt", "passport"]), days: z.number().int().min(1).max(30) }).strict(), "A receipt omits source text and personal details. A passport is complete and needs this separate, explicit grant."),
  AgentTokenRequest: named("AgentTokenRequest", z.object({ name: z.string().trim().min(1).max(80) }).strict()),
  LinkLegacy: named("LinkLegacy", z.object({ runId: uuid }).strict()),
  LicensorReview: named("LicensorReview", z.object({ decision: z.enum(["approved", "rejected", "suspended"]), reason: z.string().trim().min(1).max(4000) }).strict()),
  OfferReview: named("OfferReview", z.object({ version: z.number().int().positive(), decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(10).max(4000) }).strict()),
  DisputeResolution: named("DisputeResolution", z.object({ decision: z.enum(["release", "refund", "escalate"]), reason: z.string().trim().min(10).max(4000) }).strict()),
  Reconciliation: named("Reconciliation", z.object({ providerId: z.string().regex(/^[A-Za-z0-9-]{1,120}$/), reason: z.string().trim().min(10).max(4000) }).strict(), "Names an existing provider record. Reconciliation only reads it; it never sends or repeats a payment."),
  AssignLegacy: named("AssignLegacy", z.object({ runId: uuid, ownerId: uuid, reason: z.string().trim().min(10).max(4000) }).strict()),
};

// ---- responses ------------------------------------------------------------------------------------------------
const Operation = named("Operation", z.object({
  id: uuid, runId: uuid, kind: z.enum(["pipeline", "order", "capture", "payout", "refund", "refresh", "webhook"]),
  status: z.enum(["queued", "running", "succeeded", "failed", "reconcile", "canceled"]), stage: z.enum(["waiting", "prepared", "submitted", "recorded"]),
  code: z.string().optional().describe("For example ORDER_NOT_APPROVED: the provider refused before acting and the request may be repeated by a person."),
}), "A durable background operation. `reconcile` means the outcome is uncertain and only staff may resolve it, by reading existing provider records.");
const CatalogOffer = named("CatalogOffer", z.object({ id: uuid, version: z.number().int(), status: z.string().optional(), offer: z.looseObject({ id: z.string(), assetId: z.string(), priceCents: z.number().int(), currency: z.string() }), document: z.looseObject({ id: z.string(), assetId: z.string(), text: z.string() }) }));
const QueuedOffer = z.looseObject({ id: uuid, version: z.number().int(), offer: z.looseObject({}), document: z.looseObject({}) });
export const Res = {
  Ready: named("MarketplaceReady", z.object({ ready: z.literal(true), payments: z.literal("sandbox-only") })),
  Health: named("MarketplaceHealth", z.object({
    status: z.enum(["ok", "degraded"]), ready_jobs: z.number().int(), oldest_ready_seconds: z.number().int(), running_jobs: z.number().int(), reconcile_jobs: z.number().int(),
    unmatched_webhooks: z.number().int(), live_workers: z.number().int(), reasons: z.array(z.string()),
  }), "Counts only. 503 with status `degraded` when queued work exists and no worker has reported recently."),
  Operation,
  CatalogOffer,
  LicensorProfile: named("LicensorProfile", z.object({ licensor: z.object({ id: uuid, version: z.number().int(), status: z.enum(["pending", "approved", "rejected", "suspended"]), recipientConfirmed: z.boolean(), reason: z.string().nullable(), details: licensorSubmission.partial().loose() }).nullable() })),
  Submitted: named("Submitted", z.object({ id: uuid, version: z.number().int(), status: z.string() })),
  RecipientConfirmed: named("RecipientConfirmed", z.object({ confirmed: z.literal(true), assurance: z.string() })),
  Purchases: named("LicensorPurchases", z.object({ purchases: z.array(z.object({ run_id: uuid, payout_state: z.string(), captured_at: z.string().nullable() })) })),
  DisputeOpened: named("DisputeOpened", z.object({ id: uuid, status: z.enum(["open", "escalated"]) })),
  ShareCreated: named("ShareCreated", z.object({ id: uuid, token: z.string().length(43), kind: z.enum(["receipt", "passport"]), expiresAt: z.string(), url: z.string() }), "The token is shown once; only its hash is stored."),
  Shares: named("Shares", z.object({ shares: z.array(z.object({ id: uuid, kind: z.enum(["receipt", "passport"]), expires_at: z.string(), revoked_at: z.string().nullable() })) })),
  Revoked: named("Revoked", z.object({ revoked: z.literal(true) })),
  SharedReceipt: named("SharedReceipt", z.object({ kind: z.literal("receipt"), status: z.string(), currency: z.string(), totalCents: z.number().int(), environment: z.literal("sandbox"), bundleCommitment: z.string(), ledgerCommitment: z.string().optional(), verification: z.string() })),
  AgentTokenCreated: named("AgentTokenCreated", z.object({ id: uuid, token: z.string().length(43), scope: z.array(z.string()), expiresInDays: z.number().int() }), "Shown once."),
  AgentTokens: named("AgentTokens", z.object({ tokens: z.array(z.object({ id: uuid, name: z.string(), expires_at: z.string(), revoked_at: z.string().nullable() })) })),
  Linked: named("Linked", z.object({ linked: z.literal(true) })),
  Assigned: named("Assigned", z.object({ assigned: z.literal(true) })),
  StaffQueue: named("StaffQueue", z.object({
    licensors: z.array(z.looseObject({ id: uuid, version: z.number().int(), status: z.string(), recipientConfirmed: z.boolean() })), offers: z.array(QueuedOffer), disputes: z.array(z.looseObject({ id: uuid, runId: uuid, status: z.string() })),
    operations: z.array(z.looseObject({ id: uuid, kind: z.string(), status: z.literal("reconcile") })),
    webhooks: z.array(z.object({ eventId: z.string(), status: z.enum(["queued", "reconcile"]), attempts: z.number().int(), receivedAt: z.string(), lastAttemptAt: z.string().nullable() })),
  })),
  DisputeResolved: named("DisputeResolved", z.object({ id: uuid, status: z.string(), operation: Operation.optional() })),
  Reconciled: named("Reconciled", z.object({ id: uuid, status: z.literal("succeeded"), runId: uuid })),
};
export const CatalogList = named("Catalog", z.object({ offers: z.array(Res.CatalogOffer) }));
export const MyOffers = named("MyOffers", z.object({ offers: z.array(Res.CatalogOffer) }));

// ---- routes ---------------------------------------------------------------------------------------------------
export type Auth = "public" | "session" | "agent-read" | "staff";
export interface RouteSpec {
  path: string; method: "get" | "post" | "delete"; summary: string; auth: Auth;
  request?: z.ZodType; response?: z.ZodType; status?: 200 | 201 | 202; errors?: [string, string][]; note?: string;
}
const bad: [string, string] = ["400", "The body does not match the schema, or a required reason is missing."];
const notFound: [string, string] = ["404", "No such record, or it belongs to another account (the two are indistinguishable)."];
const conflict: [string, string] = ["409", "The record is not in a state that allows this action."];

export const ROUTE_SPECS: RouteSpec[] = [
  { path: "/api/marketplace/ready", method: "get", summary: "Check database readiness", auth: "public", response: Res.Ready, errors: [["503", "Migrations have not been applied."]] },
  { path: "/api/marketplace/health", method: "get", summary: "Report worker, queue and reconciliation health", auth: "public", response: Res.Health, errors: [["503", "Degraded: queued work with no live worker, or work older than two minutes (the body still has the counts)."]] },
  { path: "/api/marketplace/shared/{token}", method: "get", summary: "Read an unexpired, revocable share", auth: "public", response: z.union([Res.SharedReceipt, z.looseObject({ bundle: z.unknown() })]), errors: [notFound],
    note: "A receipt omits source text and personal details. A full passport is returned only for a separate full-passport grant. A refunded or reversed purchase is not shared." },
  { path: "/api/marketplace/catalog", method: "get", summary: "List reviewed marketplace offers", auth: "agent-read", response: CatalogList, note: "Only offers approved at their licensor's current reviewed version. A record that cannot be read is left out, not shown partially." },
  { path: "/api/marketplace/operations/{id}", method: "get", summary: "Read an owned background operation", auth: "agent-read", response: Res.Operation, errors: [notFound] },
  { path: "/api/marketplace/licensor", method: "get", summary: "Read your licensor profile", auth: "session", response: Res.LicensorProfile },
  { path: "/api/marketplace/licensor", method: "post", summary: "Submit or resubmit your licensor profile", auth: "session", request: Req.LicensorSubmission, response: Res.Submitted, status: 201, errors: [bad], note: "Resubmitting creates a new version that needs a fresh review and recipient confirmation." },
  { path: "/api/marketplace/licensor/confirm", method: "post", summary: "Confirm the verified account email as recipient", auth: "session", response: Res.RecipientConfirmed, errors: [notFound], note: "Proves control of the account email only; PayPal account ownership is not verified." },
  { path: "/api/marketplace/licensor/purchases", method: "get", summary: "Read purchases involving your reviewed offers", auth: "session", response: Res.Purchases },
  { path: "/api/marketplace/offers", method: "get", summary: "List your offer versions", auth: "session", response: MyOffers },
  { path: "/api/marketplace/offers", method: "post", summary: "Submit an immutable offer version", auth: "session", request: Req.OfferSubmission, response: Res.Submitted, status: 201, errors: [bad, ["403", "An approved licensor profile is required."], ["409", "A stated term has no located quotation, or a quotation is not in the source text."]] },
  { path: "/api/marketplace/offers/{id}", method: "delete", summary: "Withdraw an offer version (query: version)", auth: "session", response: Res.Submitted, errors: [notFound, conflict], note: "Runs already authorized keep their immutable snapshot; new runs cannot select a withdrawn version." },
  { path: "/api/marketplace/runs/{id}/accept", method: "post", summary: "Accept a captured purchase and request payout release", auth: "session", response: Res.Operation, status: 202, errors: [notFound, conflict], note: "Queues the payout operation. Poll `/api/marketplace/operations/{id}`; the release is re-checked (dispute, reversal, licensor status) immediately before submission." },
  { path: "/api/marketplace/runs/{id}/disputes", method: "post", summary: "Open a dispute with private evidence", auth: "session", request: Req.DisputeSubmission, response: Res.DisputeOpened, status: 201, errors: [bad, notFound, conflict], note: "Unsent payouts are held. If transfers may already have been submitted the dispute opens as `escalated`." },
  { path: "/api/marketplace/runs/{id}/shares", method: "get", summary: "List sharing grants for a run", auth: "session", response: Res.Shares, errors: [notFound] },
  { path: "/api/marketplace/runs/{id}/shares", method: "post", summary: "Create an explicit receipt or passport grant", auth: "session", request: Req.ShareRequest, response: Res.ShareCreated, status: 201, errors: [bad, notFound, conflict] },
  { path: "/api/marketplace/shares/{id}", method: "delete", summary: "Revoke an owned sharing grant", auth: "session", response: Res.Revoked, errors: [notFound], note: "Revocation cannot recall a passport someone already downloaded." },
  { path: "/api/marketplace/link-legacy", method: "post", summary: "Link an imported run using its original browser ownership", auth: "session", request: Req.LinkLegacy, response: Res.Linked, errors: [["403", "This run cannot be linked from this browser."]] },
  { path: "/api/marketplace/agent-tokens", method: "get", summary: "List your limited agent credentials", auth: "session", response: Res.AgentTokens },
  { path: "/api/marketplace/agent-tokens", method: "post", summary: "Issue a limited agent credential", auth: "session", request: Req.AgentTokenRequest, response: Res.AgentTokenCreated, status: 201, errors: [bad], note: "Valid for seven days. It can create catalogue runs and read runs, passports, operations and the catalogue; it cannot approve, claim, pay, release, share or use staff routes." },
  { path: "/api/marketplace/agent-tokens/{id}", method: "delete", summary: "Revoke an agent credential", auth: "session", response: Res.Revoked },
  { path: "/api/marketplace/staff/reviews", method: "get", summary: "Read the staff review and reconciliation queue", auth: "staff", response: Res.StaffQueue },
  { path: "/api/marketplace/staff/licensors/{id}", method: "post", summary: "Review or suspend a licensor with a reason", auth: "staff", request: Req.LicensorReview, response: Res.Submitted, errors: [bad, notFound, ["403", "Staff cannot review their own profile."], conflict] },
  { path: "/api/marketplace/staff/offers/{id}", method: "post", summary: "Review an immutable offer version", auth: "staff", request: Req.OfferReview, response: Res.Submitted, errors: [bad, notFound, ["403", "Staff cannot review their own offer."], conflict], note: "The reason (at least ten characters) is stored in the audit trail." },
  { path: "/api/marketplace/staff/disputes/{id}", method: "post", summary: "Resolve or escalate a dispute", auth: "staff", request: Req.DisputeResolution, response: Res.DisputeResolved, errors: [bad, notFound, conflict], note: "`release` and `refund` queue operations only while funds are certainly unsent; otherwise escalate." },
  { path: "/api/marketplace/staff/reconcile/{id}", method: "post", summary: "Reconcile an uncertain operation against Sandbox records", auth: "staff", request: Req.Reconciliation, response: Res.Reconciled, errors: [bad, conflict], note: "Reads the named existing provider record and checks it against the authorized purchase. It never creates a new transfer identity." },
  { path: "/api/marketplace/staff/assign-legacy", method: "post", summary: "Assign an unowned imported run with an audit reason", auth: "staff", request: Req.AssignLegacy, response: Res.Assigned, errors: [bad, conflict] },
];
