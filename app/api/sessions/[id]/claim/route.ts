import { claimSession, SessionError, viewOf } from "@/src/app-logic/session";
import { fail, json, sessionOr404 } from "@/src/server/http";
import { ownerCookie, ownerFor } from "@/src/server/owner";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/**
 * A person takes control of a run an AI agent started. POST only, with the one-time token: opening
 * the link (or a chat app previewing it) changes nothing, so the click has to be deliberate.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = sessionOr404((await params).id);
    if (!session) return json({ error: "Session not found." }, 404);
    const body = (await req.json().catch(() => ({}))) as { token?: unknown };
    if (typeof body.token !== "string" || !body.token) throw new SessionError("This link is not valid.");
    const owner = ownerFor(req);
    claimSession(session, body.token, owner.id);
    const res = json(viewOf(session));
    res.headers.append("Set-Cookie", ownerCookie(owner.id, getRuntime().appUrl.startsWith("https:")));
    return res;
  } catch (e) {
    return fail(e);
  }
}
