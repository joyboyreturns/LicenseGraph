import { viewOf } from "@/src/app-logic/session";
import { json, sessionOr404 } from "@/src/server/http";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = sessionOr404((await params).id);
  return session ? json(viewOf(session)) : json({ error: "Session not found." }, 404);
}
