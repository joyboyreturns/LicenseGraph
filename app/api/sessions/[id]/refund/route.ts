import { refundPurchase, viewOf } from "@/src/app-logic/session";
import { fail, forbidUnlessOwner, json, sessionOr404 } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** Return the buyer's payment when the creators could not be paid. Refused unless it is certain nobody was paid. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = sessionOr404((await params).id);
    if (!session) return json({ error: "Session not found." }, 404);
    const denied = forbidUnlessOwner(session, req);
    if (denied) return denied;
    await refundPurchase(session, getRuntime().deps);
    return json(viewOf(session));
  } catch (e) {
    return fail(e);
  }
}
