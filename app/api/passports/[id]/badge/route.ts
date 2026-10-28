import { badgeSvg } from "@/src/passport/badge";
import { issuePassport } from "@/src/passport/issue";
import { PassportError, verifyPassport } from "@/src/passport/passport";
import { json, sessionOr404 } from "@/src/server/http";

export const dynamic = "force-dynamic";

/** A status badge (SVG) for a paid run's Licence Passport, from the passport's own re-verification. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = sessionOr404((await params).id);
  if (!session) return json({ error: "Passport not found." }, 404);
  try {
    const passport = issuePassport(session);
    const { ok, checks } = await verifyPassport(passport);
    const reversed = checks.some((c) => c.id === "payment-standing" && !c.ok);
    return new Response(badgeSvg({ verified: ok, licences: passport.bundle.offers.length, reversed }), {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300" },
    });
  } catch (e) {
    return json({ error: e instanceof PassportError ? e.message : "Could not issue the passport." }, e instanceof PassportError ? 409 : 500);
  }
}
