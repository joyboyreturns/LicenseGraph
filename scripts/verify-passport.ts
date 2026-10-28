/**
 * Re-check a Licence Passport from nothing but its own contents, outside the app and outside a browser:
 *   npm run verify:passport -- licence-passport.json
 *   npm run verify:passport -- http://localhost:3000/api/passports/<run id>
 *   npm run verify:passport -- licence-passport.json --key <public key>
 * With --key, the issuer's signature is checked too, offline, against that public key (published by the issuing server at
 * /.well-known/licensegraph-keys.json). Pin the key you were given rather than fetching it from the same place as the passport.
 * Exits 0 when every check passes and 1 when any fails, so it can sit in a script or a CI job.
 */
import { readFile } from "node:fs/promises";
import { verifyPassport, type Passport } from "../src/passport/passport";
import { formatReport } from "../src/passport/report";
import { verifyWithPublicKey } from "../src/server/passport-signing";

const args = process.argv.slice(2);
const keyAt = args.indexOf("--key");
const key = keyAt >= 0 ? args[keyAt + 1] : undefined;
const source = args.find((a, i) => !a.startsWith("--") && (keyAt < 0 || i !== keyAt + 1));
if (!source || (keyAt >= 0 && !key)) {
  console.error("Usage: npm run verify:passport -- <passport.json | http(s) URL of a passport> [--key <issuer public key>]");
  process.exit(2);
}

async function load(from: string): Promise<unknown> {
  if (/^https?:\/\//i.test(from)) {
    const res = await fetch(from);
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    return res.json();
  }
  return JSON.parse(await readFile(from, "utf8"));
}

try {
  const passport = (await load(source)) as Passport;
  if (!passport?.ledger?.events || !passport.bundle || !passport.approval) throw new Error("This does not look like a Licence Passport.");
  const result = await verifyPassport(passport);
  console.log(formatReport(result));
  let signed = true;
  if (key) {
    const state = verifyWithPublicKey(passport, key);
    signed = state === "valid";
    console.log(state === "valid" ? `\nIssuer signature: valid (Ed25519, key ${passport.signature?.keyId ?? "unknown"}), checked here against the key you gave.` : `\nIssuer signature: ${state}. This passport was not shown to be issued by that key.`);
  }
  process.exit(result.ok && signed ? 0 : 1);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}
