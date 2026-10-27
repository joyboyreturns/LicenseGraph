import { approveSession, viewOf } from "@/src/app-logic/session";
import { fail, json, sessionOr404 } from "@/src/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = sessionOr404((await params).id);
    if (!session) return json({ error: "Session not found." }, 404);
    const body = (await req.json().catch(() => ({}))) as { approvedBy?: unknown };
    approveSession(session, typeof body.approvedBy === "string" ? body.approvedBy : "");
    return json(viewOf(session));
  } catch (e) {
    return fail(e);
  }
}
