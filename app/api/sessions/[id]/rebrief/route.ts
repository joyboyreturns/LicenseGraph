import { rebriefInput, recordRebrief } from "@/src/app-logic/revision";
import { createSession, runPipeline, SessionError, viewOf } from "@/src/app-logic/session";
import { describeChange } from "@/src/core/whatif";
import { fail, forbidUnlessOwner, json, sessionOr404 } from "@/src/server/http";
import { ownerCookie, ownerFor } from "@/src/server/owner";
import { getRuntime } from "@/src/server/runtime";
import { rebriefInputSchema } from "@/src/server/session-input";

export const dynamic = "force-dynamic";

const MAX_ACTIVE_RUNS = 3;

/**
 * Make a what-if real: check the same licences against a changed brief as a new run. The earlier run is not
 * changed, and nothing the earlier run read is read again. Nothing is bought here: only a bundle that passes
 * the rules for the changed brief can be approved and paid.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const rt = getRuntime();
    const from = sessionOr404((await params).id);
    if (!from) return json({ error: "Session not found." }, 404);
    const denied = forbidUnlessOwner(from, req);
    if (denied) return denied;
    if (from.order || from.capture) throw new SessionError("This run already has a payment in progress. Start a new run to change the brief.");
    if (from.phase !== "failed" && from.phase !== "verified") throw new SessionError("Wait for the run to finish before changing the brief.");
    if (!from.candidates.length) throw new SessionError("This run read no licences, so there is nothing to check against a changed brief.");

    const parsed = rebriefInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new SessionError(`Invalid change: ${parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")}`);

    // A built-in scenario stays a replay; anything else proposes with the real model, so it is limited like any live run.
    const replay = Boolean(from.input.meta?.scenarioId);
    if (!replay && rt.store.activeCount() >= MAX_ACTIVE_RUNS) return json({ error: "Too many runs in progress. Try again in a minute." }, 429);

    const change = parsed.data.change;
    const owner = ownerFor(req);
    const session = createSession(rebriefInput(from.input, from.id, change));
    session.ownerId = owner.id;
    recordRebrief(session, from, change, describeChange(change));
    rt.store.add(session);
    const deps = replay ? rt.demoDeps : rt.deps;
    // Every licence was already read, so the new run proposes and verifies without reading anything again.
    void runPipeline(session, deps, { fromRunId: from.id, offers: from.candidates }).catch((e) => {
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
