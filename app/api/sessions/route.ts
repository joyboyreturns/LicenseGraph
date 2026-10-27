import { createSession, runPipeline, viewOf, SessionError, type SessionInput } from "@/src/app-logic/session";
import { fail, json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

const MAX_DOCS = 12;
const MAX_TEXT = 20_000;

function parse(body: unknown): SessionInput {
  const b = body as Partial<SessionInput> | null;
  if (!b || typeof b !== "object" || !b.project || !Array.isArray(b.requiredAssetIds) || !Array.isArray(b.documents)) {
    throw new SessionError("Send a project, requiredAssetIds and documents.");
  }
  if (b.documents.length > MAX_DOCS) throw new SessionError(`At most ${MAX_DOCS} documents.`);
  if (b.documents.some((d) => typeof d?.text !== "string" || d.text.length > MAX_TEXT)) throw new SessionError(`Each document must be text of at most ${MAX_TEXT} characters.`);
  const p = b.project;
  return {
    project: {
      name: String(p.name ?? ""),
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
    requiredAssetIds: b.requiredAssetIds.map(String),
    documents: b.documents.map((d) => ({ id: String(d.id), assetId: String(d.assetId), text: d.text })),
  };
}

export async function POST(req: Request) {
  try {
    const rt = getRuntime();
    const session = rt.store.add(createSession(parse(await req.json().catch(() => null))));
    // Runs in the background; the page polls the session. Failures are recorded on the session.
    void runPipeline(session, rt.deps).catch((e) => {
      session.phase = "failed";
      session.failure = e instanceof Error ? e.message : "The run failed.";
    });
    return json(viewOf(session), 201);
  } catch (e) {
    return fail(e);
  }
}
