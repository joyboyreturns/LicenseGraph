import { passportKey } from "@/src/server/passport-signing";
import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/**
 * The public key that checks this server's Licence Passports. With it, anyone can confirm a passport was issued here
 * and has not changed, without calling the server again (`npm run verify:passport -- passport.json --key <publicKey>`).
 */
export function GET() {
  const secret = getRuntime().passportSecret;
  if (!secret) return json({ error: "This server does not sign passports." }, 404);
  const secrets = [secret, ...(process.env.LICENSEGRAPH_STORAGE === "postgres" && process.env.LICENSEGRAPH_PASSPORT_SECRET ? [process.env.LICENSEGRAPH_PASSPORT_SECRET] : [])];
  return json({ keys: secrets.map((value) => { const { publicKey, keyId } = passportKey(value); return { keyId, algorithm: "Ed25519", publicKey, use: "licence-passport-signature" }; }) });
}
