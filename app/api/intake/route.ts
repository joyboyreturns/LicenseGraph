import { parseBrief } from "@/src/intake/brief";
import { fail, json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** Turn a plain-English brief into a project. Uses the free model when configured, and always falls back to the local reader. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text.length < 5) return json({ error: "Describe your project in a sentence or two." }, 400);
    if (text.length > 2000) return json({ error: "Keep the description under 2,000 characters." }, 413);
    return json(await parseBrief(text, getRuntime().intakeModel));
  } catch (e) {
    return fail(e);
  }
}
