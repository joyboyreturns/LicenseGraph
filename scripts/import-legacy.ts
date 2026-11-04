import { resolve } from "node:path";
import { RecordCipher } from "../src/storage/crypto";
import { Database } from "../src/storage/database";
import { importLegacyRuns } from "../src/storage/legacy-import";
import { RunRepository } from "../src/storage/runs";

// node --env-file=.env.local-infra --import tsx scripts/import-legacy.ts [--dir .data] [--dry-run]
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const dirIndex = args.indexOf("--dir");
if (dirIndex >= 0 && !args[dirIndex + 1]) throw new Error("--dir needs a directory.");
const directory = resolve(dirIndex >= 0 ? args[dirIndex + 1]! : ".data");
const required = (name: string) => process.env[name] ?? (() => { throw new Error(`Set ${name}.`); })();

const db = Database.connect(required("DATABASE_URL"));
try {
  const runs = new RunRepository(db, new RecordCipher(required("LICENSEGRAPH_STORAGE_KEY_ID"), JSON.parse(required("LICENSEGRAPH_STORAGE_KEYS"))));
  const outcomes = await importLegacyRuns(db, runs, directory, { dryRun });
  const count = (status: string) => outcomes.filter((o) => o.status === status).length;
  console.log(`${dryRun ? "Dry run: nothing was written. " : ""}Imported ${count("imported")}, quarantined ${count("quarantined")}, already handled ${count("skipped")}.`);
  for (const o of outcomes.filter((o) => o.status === "quarantined")) console.log(`  quarantined ${o.file}: ${o.reason}`);
} finally { await db.pool.end(); }
