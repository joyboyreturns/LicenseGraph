import { reviseInput } from "@/src/app-logic/revision";
import { createSession, runPipeline, SessionError, viewOf } from "@/src/app-logic/session";
import { fail, forbidUnlessOwner, json, sessionOr404 } from "@/src/server/http";
import { ownerCookie, ownerFor } from "@/src/server/owner";
import { getRuntime } from "@/src/server/runtime";
import { reviseInputSchema } from "@/src/server/session-input";

export const dynamic = "force-dynamic";

const MAX_ACTIVE_RUNS = 3;

/**
 * Answer a gap request: add a licensor's revised licence (or, in a demo scenario, their simulated replies)
 * and check everything again as a new run. The earlier run is not changed. Nothing is bought here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rt = getRuntime();
    const from = sessionOr404((await params).id);
    if (!from) return json({ error: "Session not found." }, 404);
    const denied = forbidUnlessOwner(from, req);
    if (denied) return denied;
    if (from.order || from.capture) throw new SessionError("This run already has a payment in progress. Start a new run to try different licences.");
    if (from.phase !== "failed" && from.phase !== "verified") throw new SessionError("Wait for the run to finish before adding a revised licence.");

    const parsed = reviseInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new SessionError(`Invalid revision: ${parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")}`);
    const simulated = "simulate" in parsed.data;
    if (!simulated && rt.mode === "demo" && rt.deps.model === rt.demoDeps.model) {
      throw new SessionError("Reading a pasted licence needs a model. Set AI_GATEWAY_API_KEY and a free LICENSEGRAPH_MODEL on the server.");
    }
    if (!simulated && rt.store.activeCount() >= MAX_ACTIVE_RUNS) return json({ error: "Too many runs in progress. Try again in a minute." }, 429);

    const input = reviseInput(from.input, from.id, parsed.data);
    if (!simulated) {
      // Pasted text is read by the real model, so this is no longer a replay of recorded output.
      const { scenarioId: _scenario, ...meta } = input.meta ?? {};
      input.meta = { ...meta, runKind: rt.mode };
    }

    const owner = ownerFor(req);
    const session = createSession(input);
    session.ownerId = owner.id;
    rt.store.add(session);
    const deps = simulated ? rt.demoDeps : rt.deps;
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
