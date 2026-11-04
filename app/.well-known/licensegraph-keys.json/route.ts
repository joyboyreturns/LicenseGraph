import { publishedKeys, retiredSecretsFromEnv } from "@/src/server/passport-signing";
import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/**
 * The public keys that check this server's Licence Passports. With one, anyone can confirm a passport was issued here
 * and has not changed, without calling the server again (`npm run verify:passport -- passport.json --key <publicKey>`).
 * After a rotation the retired keys stay listed, marked as retired, so older passports keep verifying.
 */
export function GET() {
  const secret = process.env.LICENSEGRAPH_STORAGE === "postgres" ? process.env.LICENSEGRAPH_PASSPORT_SECRET || undefined : getRuntime().passportSecret;
  if (!secret) return json({ error: "This server does not sign passports." }, 404);
  return json({ keys: publishedKeys(secret, retiredSecretsFromEnv()) });
}
