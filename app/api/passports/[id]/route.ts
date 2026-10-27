import { issuePassport } from "@/src/passport/issue";
import { PassportError } from "@/src/passport/passport";
import { signPassport } from "@/src/server/passport-signing";
import { getRuntime } from "@/src/server/runtime";
import { json, sessionOr404 } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** The Licence Passport for a paid run. Add ?download=1 to save it as a file. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = sessionOr404((await params).id);
  if (!session) return json({ error: "Passport not found." }, 404);
  try {
    const passport = signPassport(issuePassport(session), getRuntime().passportSecret);
    const res = json(passport);
    if (new URL(req.url).searchParams.get("download")) res.headers.set("Content-Disposition", `attachment; filename="licence-passport-${session.id.slice(0, 8)}.json"`);
    return res;
  } catch (e) {
    return json({ error: e instanceof PassportError ? e.message : "Could not issue the passport." }, e instanceof PassportError ? 409 : 500);
  }
}
