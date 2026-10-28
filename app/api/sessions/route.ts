import { createSession, runPipeline, SessionError, viewOf, type SessionInput } from "@/src/app-logic/session";
import { scenarioById } from "@/src/demo/scenarios";
import { fail, json } from "@/src/server/http";
import { ownerCookie, ownerFor, readOwner } from "@/src/server/owner";
import { getRuntime } from "@/src/server/runtime";
import { z } from "zod";
import { isIsoDate } from "@/src/core/dates";
import { supportsCentCurrency } from "@/src/core/money";

export const dynamic = "force-dynamic";

const MAX_DOCS = 12;
const MAX_TEXT = 20_000;
/** Each live run makes several model requests; cap concurrency so one visitor cannot exhaust the gateway. */
const MAX_ACTIVE_RUNS = 3;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const textId = z.string().trim().min(1).max(55);
const inputSchema = z.object({
  project: z.object({
    name: z.string().trim().min(1).max(120),
    commercial: z.boolean(),
    territories: z.array(z.string().trim().toUpperCase().regex(/^(WORLD|[A-Z]{2})$/)).min(1).max(250),
    termMonths: z.number().int().safe().positive().max(1200),
    budgetCents: z.number().int().safe().nonnegative().optional(),
    currency: z.string().refine(supportsCentCurrency, "Unsupported settlement currency").optional(),
    mediums: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
    canCredit: z.boolean().optional(),
    needsSublicensing: z.boolean().optional(),
    requiresExclusive: z.boolean().optional(),
    endDate: z.string().refine(isIsoDate, "Expected a real calendar date").optional(),
  }),
  requiredAssetIds: z.array(textId).min(1).max(MAX_DOCS),
  documents: z.array(z.object({
    id: textId, assetId: textId,
    text: z.string().min(1).max(MAX_TEXT),
    licensor: z.object({ name: z.string().trim().min(1).max(80), email: z.string().max(127).regex(EMAIL) }).optional(),
  })).min(1).max(MAX_DOCS),
  brief: z.string().max(2000).optional(),
});

type Body = { scenarioId?: unknown; brief?: unknown } & Partial<SessionInput>;

function parse(body: Body | null): SessionInput {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new SessionError(`Invalid run input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const { project, requiredAssetIds, documents, brief } = parsed.data;
  return { project, requiredAssetIds, documents, meta: { brief } };
}

export async function POST(req: Request) {
  try {
    const rt = getRuntime();
    const body = (await req.json().catch(() => null)) as Body | null;

    // A built-in scenario is replayed from recorded model output: instant, repeatable, and labelled as a demo run.
    const scenario = typeof body?.scenarioId === "string" ? scenarioById(body.scenarioId) : undefined;
    if (typeof body?.scenarioId === "string" && !scenario) throw new SessionError("Unknown scenario.");
    const input: SessionInput = scenario
      ? { project: { ...scenario.project }, requiredAssetIds: [...scenario.requiredAssetIds], documents: scenario.documents.map((d) => ({ ...d })), meta: { scenarioId: scenario.id, brief: scenario.brief, runKind: "demo" } }
      : (() => {
          const i = parse(body);
          return { ...i, meta: { ...i.meta, runKind: rt.mode } };
        })();

    if (!scenario && rt.mode === "demo" && rt.deps.model === rt.demoDeps.model) {
      throw new SessionError("Your own licences need a model. Run a built-in scenario, or set AI_GATEWAY_API_KEY and a free LICENSEGRAPH_MODEL on the server.");
    }
    if (!scenario && rt.store.activeCount() >= MAX_ACTIVE_RUNS) return json({ error: "Too many runs in progress. Try again in a minute." }, 429);

    const owner = ownerFor(req);
    const session = createSession(input);
    session.ownerId = owner.id;
    rt.store.add(session);
    const deps = scenario ? rt.demoDeps : rt.deps;
    // Runs in the background; the page polls the session. Failures are recorded on the session.
    void runPipeline(session, deps).catch((e) => {
      session.phase = "failed";
      session.failure = e instanceof Error ? e.message : "The run failed.";
      session.onChange?.();
    });
    const res = json(viewOf(session), 201);
    if (owner.isNew) res.headers.append("Set-Cookie", ownerCookie(owner.id, rt.appUrl.startsWith("https:")));
    return res;
  } catch (e) {
    return fail(e);
  }
}

/** The caller's own runs, newest first: the portfolio. Runs from before owners existed are shown to everyone. */
export function GET(req: Request) {
  const me = readOwner(req);
  const runs = getRuntime().store.list().filter((s) => !s.ownerId || s.ownerId === me).map((s) => {
    const v = viewOf(s);
    return {
      id: s.id,
      createdAt: s.createdAt,
      name: s.input.project.name,
      phase: s.phase,
      runKind: s.input.meta?.runKind,
      scenarioId: s.input.meta?.scenarioId,
      rounds: v.rounds,
      totalCents: v.bundle?.totalCents,
      currency: v.bundle?.currency,
      naiveTotalCents: v.analysis?.naiveTotalCents,
      blocked: v.analysis?.blockedPurchases.length ?? 0,
      paid: Boolean(s.capture),
    };
  });
  return json({ runs });
}
