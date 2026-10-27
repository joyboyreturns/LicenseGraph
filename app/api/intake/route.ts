import { parseBrief } from "@/src/intake/brief";
import { fail, json } from "@/src/server/http";
import { createRateLimiter } from "@/src/server/rate-limit";
import { getRuntime } from "@/src/server/runtime";

// The free model allows about five requests a minute; past this budget the offline reader answers instead.
const modelBudget = createRateLimiter(4, 60_000);

export const dynamic = "force-dynamic";

/** Turn a plain-English brief into a project. Uses the free model when configured, and always falls back to the local reader. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text.length < 5) return json({ error: "Describe your project in a sentence or two." }, 400);
    if (text.length > 2000) return json({ error: "Keep the description under 2,000 characters." }, 413);
    const { intakeModel } = getRuntime();
    return json(await parseBrief(text, intakeModel && modelBudget.take() ? intakeModel : undefined));
  } catch (e) {
    return fail(e);
  }
}
