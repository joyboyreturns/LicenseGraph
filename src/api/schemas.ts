import { z } from "zod";
import { LEDGER_KINDS } from "../ledger/chain";
import { offerSchema, projectSchema } from "../mcp/tools";

/**
 * The shapes the HTTP API returns, written once as zod schemas. The OpenAPI document is generated from
 * them, and a test parses real responses with them, so the published contract cannot drift from the app.
 */

const money = z.object({ currency: z.string().length(3), value: z.string().describe('Decimal amount as PayPal writes it, e.g. "329.00".') });
const phase = z.enum(["created", "extracting", "proposing", "verified", "failed", "approved", "order_created", "captured", "settled", "refunded"]);
const ledgerKind = z.enum(LEDGER_KINDS);

export const Project = projectSchema.meta({ id: "Project" });
export const Offer = offerSchema.meta({ id: "Offer", description: "One licence offer read from a licence document, with the quotes that back each term." });

export const LedgerEvent = z
  .object({
    seq: z.number().int(),
    at: z.string(),
    kind: ledgerKind,
    payload: z.record(z.string(), z.unknown()),
    prevHash: z.string().length(64),
    hash: z.string().length(64).describe("SHA-256 over the event and prevHash; changing any event breaks every hash after it."),
  })
  .meta({ id: "LedgerEvent" });

const payoutLine = z.object({
  assetId: z.string(),
  offerId: z.string(),
  documentId: z.string(),
  licensorName: z.string(),
  emailMasked: z.string().describe("The payee's email with the middle hidden."),
  amountCents: z.number().int(),
  currency: z.string(),
  status: z.string(),
  error: z.string().optional(),
});

export const SessionView = z
  .object({
    id: z.string().uuid(),
    phase,
    createdAt: z.string(),
    runDate: z.string().optional().describe("The date offers were checked against when the run started (YYYY-MM-DD)."),
    failure: z.string().optional(),
    awaitingPerson: z.boolean().optional().describe("An agent started this run and no person has taken control yet, so it cannot be approved or paid."),
    project: Project,
    meta: z.object({ scenarioId: z.string().optional(), brief: z.string().optional(), runKind: z.enum(["demo", "live"]).optional(), startedBy: z.literal("agent").optional() }).optional(),
    documents: z.array(z.object({ id: z.string(), assetId: z.string(), text: z.string(), licensorName: z.string().optional() })),
    candidates: z.array(Offer).describe("Every offer read from the licences."),
    loopStatus: z.enum(["verified", "exhausted", "stalled"]).optional(),
    rounds: z.number().int().optional().describe("How many proposals the agent made before the rules engine accepted one."),
    bundle: z.object({ offers: z.array(Offer), totalCents: z.number().int(), currency: z.string() }).optional().describe("The verified bundle. Absent until the rules engine accepts a proposal."),
    analysis: z.looseObject({ naiveTotalCents: z.number().int(), compliancePremiumCents: z.number().int() }).optional().describe("Every offer checked against every rule, the price-only comparison, requirement costs and gaps."),
    approval: z.object({ approvedBy: z.string(), approvedAt: z.string(), bundleDigest: z.string(), digestVersion: z.literal(2).optional() }).optional(),
    order: z.object({ id: z.string(), status: z.string(), approveUrl: z.string() }).optional(),
    capture: z.object({ id: z.string(), status: z.string(), captureId: z.string(), amount: money }).optional(),
    refund: z.object({ id: z.string(), status: z.string(), amount: money, at: z.string() }).optional(),
    canRefund: z.boolean().optional().describe("The payment can be returned to the buyer: it is certain no creator was paid."),
    payoutBlockedAssets: z.array(z.string()).optional().describe("Assets whose creator has no payout email. Creating the order is refused until a new run supplies one."),
    payouts: z
      .object({ batchId: z.string(), status: z.string(), totalCents: z.number().int(), currency: z.string(), lines: z.array(payoutLine), createdAt: z.string(), error: z.string().optional(), notSent: z.boolean().optional() })
      .optional(),
    events: z.array(LedgerEvent),
    chainValid: z.boolean(),
  })
  .meta({ id: "Run", description: "Everything known about one run: what was read, what was verified, what was paid." });

export const RunCreated = SessionView.extend({
  handoff: z.object({ claimUrl: z.string().url(), expiresAt: z.string() }).optional().describe("Present when the run was started with handoff: true."),
}).meta({ id: "RunCreated" });

export const RunSummary = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    name: z.string(),
    phase,
    runKind: z.enum(["demo", "live"]).optional(),
    scenarioId: z.string().optional(),
    rounds: z.number().int().optional(),
    totalCents: z.number().int().optional(),
    currency: z.string().optional(),
    naiveTotalCents: z.number().int().optional(),
    blocked: z.number().int(),
    paid: z.boolean(),
  })
  .meta({ id: "RunSummary" });

export const Passport = z
  .looseObject({
    version: z.literal(1),
    id: z.string(),
    issuedAt: z.string(),
    project: Project,
    bundle: z.object({ offers: z.array(Offer), totalCents: z.number().int(), currency: z.string(), digest: z.string(), digestVersion: z.literal(2).optional() }),
    approval: z.object({ approvedBy: z.string(), approvedAt: z.string(), bundleDigest: z.string() }),
    paypal: z.object({ orderId: z.string(), captureId: z.string(), amount: money, environment: z.enum(["sandbox", "simulator"]) }),
    ledger: z.object({ events: z.array(LedgerEvent), head: z.string() }),
    signature: z.object({ algorithm: z.literal("HMAC-SHA256"), value: z.string() }).optional(),
  })
  .meta({ id: "Passport", description: "A self-contained record of one paid run. It can be re-checked from its own contents, with no server." });

export const PassportVerification = z
  .object({
    ok: z.boolean(),
    checks: z.array(z.object({ id: z.string(), label: z.string(), ok: z.boolean(), detail: z.string() })),
    signature: z.enum(["valid", "invalid", "unsigned", "unavailable"]).describe("Whether this server signed the passport. Only the server can check this."),
  })
  .meta({ id: "PassportVerification" });

export const ApiError = z.object({ error: z.string(), code: z.string().optional(), violations: z.array(z.unknown()).optional() }).meta({ id: "Error" });

export const BriefReading = z
  .object({
    project: Project,
    requiredAssetIds: z.array(z.string()),
    found: z.array(z.string()).describe("What the text actually said."),
    assumed: z.array(z.string()).describe("Defaults applied because the text was silent."),
    source: z.enum(["local", "model"]),
  })
  .meta({ id: "BriefReading" });

export const Answer = z.object({ answer: z.string(), source: z.enum(["model", "local"]), citations: z.array(z.string()).describe("Offer ids the answer refers to; each exists in the run.") }).meta({ id: "Answer" });

export const Health = z.object({ ok: z.literal(true), mode: z.enum(["demo", "live"]), paymentsMode: z.string(), runs: z.number().int() }).meta({ id: "Health" });

export const Config = z
  .object({ mode: z.enum(["demo", "live"]), model: z.string().optional(), paymentsEnabled: z.boolean(), paymentsMode: z.string(), assistant: z.boolean(), intakeModel: z.boolean(), passportSigned: z.boolean(), webhooks: z.boolean().describe("PayPal webhook deliveries are accepted at /api/webhooks/paypal."), appUrl: z.string() })
  .meta({ id: "Config" });

export const Scenario = z
  .object({
    id: z.string(),
    title: z.string(),
    tagline: z.string(),
    brief: z.string(),
    project: Project,
    requiredAssetIds: z.array(z.string()),
    showcases: z.array(z.string()).optional(),
    documents: z.array(z.object({ id: z.string(), assetId: z.string(), text: z.string(), licensorName: z.string().optional() })),
  })
  .meta({ id: "Scenario" });
