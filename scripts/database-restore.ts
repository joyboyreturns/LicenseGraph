import { resolve } from "node:path";
import { RecordCipher } from "../src/storage/crypto";
import { restoreDatabase, verifyDatabase } from "../src/storage/backup";
import { Database } from "../src/storage/database";

// node --env-file=.env.local-infra --import tsx scripts/database-restore.ts <backup-directory>
// DATABASE_URL must name an EMPTY database that has been migrated (npm run db:migrate). It is never merged into data.
const directory = process.argv[2];
if (!directory) throw new Error("Usage: database-restore.ts <backup-directory>");
if (!process.env.DATABASE_URL || !process.env.LICENSEGRAPH_STORAGE_KEY_ID || !process.env.LICENSEGRAPH_STORAGE_KEYS) throw new Error("Set DATABASE_URL and the storage key variables.");
const db = Database.connect(process.env.DATABASE_URL);
try {
  const manifest = await restoreDatabase(db, resolve(directory));
  const report = await verifyDatabase(db, new RecordCipher(process.env.LICENSEGRAPH_STORAGE_KEY_ID, JSON.parse(process.env.LICENSEGRAPH_STORAGE_KEYS)));
  console.log(`Restored ${manifest.tables.length} tables. Verified ${report.runs} runs, ${report.documents} documents, ${report.ledgerEvents} ledger events, ${report.authorizations} authorizations.`);
  if (report.problems.length) { for (const p of report.problems) console.error(`PROBLEM: ${p}`); process.exitCode = 1; }
} finally { await db.pool.end(); }
