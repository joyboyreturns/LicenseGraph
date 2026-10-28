/**
 * Re-check a Licence Passport from nothing but its own contents, outside the app and outside a browser:
 *   npm run verify:passport -- licence-passport.json
 *   npm run verify:passport -- http://localhost:3000/api/passports/<run id>
 * Exits 0 when every check passes and 1 when any fails, so it can sit in a script or a CI job.
 */
import { readFile } from "node:fs/promises";
import { verifyPassport, type Passport } from "../src/passport/passport";
import { formatReport } from "../src/passport/report";

const source = process.argv[2];
if (!source) {
  console.error("Usage: npm run verify:passport -- <passport.json | http(s) URL of a passport>");
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
  process.exit(result.ok ? 0 : 1);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}
