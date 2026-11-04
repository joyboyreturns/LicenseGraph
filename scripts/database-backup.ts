import { resolve } from "node:path";
import { backupDatabase } from "../src/storage/backup";
import { Database } from "../src/storage/database";

// node --env-file=.env.local-infra --import tsx scripts/database-backup.ts <empty-directory>
const directory = process.argv[2];
if (!directory) throw new Error("Usage: database-backup.ts <empty-directory>");
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");
const db = Database.connect(process.env.DATABASE_URL);
try {
  const manifest = await backupDatabase(db, resolve(directory));
  console.log(`Backup written: ${manifest.tables.length} tables, ${manifest.tables.reduce((n, t) => n + t.rows, 0)} rows. Records stay encrypted; keep the backup and the storage keys apart.`);
} finally { await db.pool.end(); }
