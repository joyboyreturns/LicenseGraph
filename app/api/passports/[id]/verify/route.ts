import { issuePassport } from "@/src/passport/issue";
import { PassportError, verifyPassport } from "@/src/passport/passport";
import { checkSignature, signPassport } from "@/src/server/passport-signing";
import { getRuntime } from "@/src/server/runtime";
import { json, sessionOr404 } from "@/src/server/http";

export const dynamic = "force-dynamic";

/**
 * Server-side check of the passport: every content check, plus whether this server signed it.
 * The browser repeats the content checks itself; only the server can check the signature.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = sessionOr404((await params).id);
  if (!session) return json({ error: "Passport not found." }, 404);
  try {
    const secret = getRuntime().passportSecret;
    const passport = signPassport(issuePassport(session), secret);
    return json({ ...(await verifyPassport(passport)), signature: checkSignature(passport, secret) });
  } catch (e) {
    return json({ error: e instanceof PassportError ? e.message : "Could not verify the passport." }, e instanceof PassportError ? 409 : 500);
  }
}
