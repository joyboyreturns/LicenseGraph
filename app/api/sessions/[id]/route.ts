import { refreshPayouts, viewOf } from "@/src/app-logic/session";
import { json, sessionOr404 } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = sessionOr404((await params).id);
  if (!session) return json({ error: "Session not found." }, 404);
  // Payouts settle a little after they are created; checking here keeps the page current.
  await refreshPayouts(session, getRuntime().deps);
  return json(viewOf(session));
}
