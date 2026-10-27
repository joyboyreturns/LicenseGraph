import { startPayment, viewOf } from "@/src/app-logic/session";
import { fail, forbidUnlessOwner, json, sessionOr404 } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = sessionOr404((await params).id);
    if (!session) return json({ error: "Session not found." }, 404);
    const denied = forbidUnlessOwner(session, req);
    if (denied) return denied;
    await startPayment(session, getRuntime().deps);
    return json(viewOf(session));
  } catch (e) {
    return fail(e);
  }
}
