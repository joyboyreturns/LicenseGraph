import { viewOf } from "@/src/app-logic/session";
import { answerQuestion, answerLocally } from "@/src/intake/explain";
import { json, sessionOr404 } from "@/src/server/http";
import { createRateLimiter } from "@/src/server/rate-limit";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

// The free model allows about five requests a minute; beyond this budget answers come from the deterministic reader.
const modelBudget = createRateLimiter(4, 60_000);

/** Ask a question about one run. Grounded in the run's recorded facts; always answers. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = sessionOr404((await params).id);
  if (!session) return json({ error: "Session not found." }, 404);
  const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (question.length < 3) return json({ error: "Ask a question about this run." }, 400);
  if (question.length > 400) return json({ error: "Keep the question under 400 characters." }, 413);

  const view = viewOf(session);
  // A run that came from another can be asked how it differs from it.
  const from = session.input.meta?.rebriefedFrom ?? session.input.meta?.revisedFrom;
  const earlierSession = from ? sessionOr404(from) : undefined;
  const earlier = earlierSession ? viewOf(earlierSession) : undefined;
  const { intakeModel } = getRuntime();
  return json(intakeModel && modelBudget.take() ? await answerQuestion(view, question, intakeModel, earlier) : answerLocally(view, question, earlier));
}
