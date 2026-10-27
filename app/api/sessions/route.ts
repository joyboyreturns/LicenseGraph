import { createSession, runPipeline, SessionError, viewOf, type SessionInput } from "@/src/app-logic/session";
import { scenarioById } from "@/src/demo/scenarios";
import { fail, json } from "@/src/server/http";
import { ownerCookie, ownerFor, readOwner } from "@/src/server/owner";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

const MAX_DOCS = 12;
const MAX_TEXT = 20_000;
/** Each live run makes several model requests; cap concurrency so one visitor cannot exhaust the gateway. */
const MAX_ACTIVE_RUNS = 3;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

type Body = { scenarioId?: unknown; brief?: unknown } & Partial<SessionInput>;

function parse(body: Body | null): SessionInput {
  if (!body || typeof body !== "object" || !body.project || !Array.isArray(body.requiredAssetIds) || !Array.isArray(body.documents)) {
    throw new SessionError("Send a project, requiredAssetIds and documents.");
  }
  if (body.documents.length > MAX_DOCS) throw new SessionError(`At most ${MAX_DOCS} documents.`);
  if (body.documents.some((d) => typeof d?.text !== "string" || d.text.length > MAX_TEXT)) throw new SessionError(`Each document must be text of at most ${MAX_TEXT} characters.`);
  const p = body.project;
  return {
    project: {
      name: String(p.name ?? "").slice(0, 120),
      commercial: Boolean(p.commercial),
      territories: (p.territories ?? []).map(String),
      termMonths: Number(p.termMonths),
      budgetCents: p.budgetCents == null ? undefined : Number(p.budgetCents),
      mediums: p.mediums?.length ? p.mediums.map(String) : undefined,
      canCredit: p.canCredit === false ? false : undefined,
      needsSublicensing: p.needsSublicensing ? true : undefined,
      requiresExclusive: p.requiresExclusive ? true : undefined,
      endDate: p.endDate ? String(p.endDate) : undefined,
    },
    requiredAssetIds: body.requiredAssetIds.map(String),
    documents: body.documents.map((d) => ({
      id: String(d.id),
      assetId: String(d.assetId),
      text: d.text,
      licensor: d.licensor && typeof d.licensor.name === "string" && EMAIL.test(String(d.licensor.email)) ? { name: d.licensor.name.slice(0, 80), email: String(d.licensor.email) } : undefined,
    })),
    meta: { brief: typeof body.brief === "string" ? body.brief.slice(0, 2000) : undefined },
  };
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
