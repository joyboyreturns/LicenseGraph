import { RecordCipher } from "../src/storage/crypto";
import { Database } from "../src/storage/database";
import { keyUsage, rekeyMutable } from "../src/storage/rekey";

// node --env-file=.env.local-infra --import tsx scripts/database-rekey.ts [--apply]
// Without --apply it only reports which key seals what. Add the new key to LICENSEGRAPH_STORAGE_KEYS and point
// LICENSEGRAPH_STORAGE_KEY_ID at it first; keep every older key configured until the report shows it unused.
const apply = process.argv.includes("--apply");
const need = (name: string) => process.env[name] ?? (() => { throw new Error(`Set ${name}.`); })();
const db = Database.connect(need("DATABASE_URL"));
try {
  const cipher = new RecordCipher(need("LICENSEGRAPH_STORAGE_KEY_ID"), JSON.parse(need("LICENSEGRAPH_STORAGE_KEYS")));
  if (apply) console.log("Re-sealed:", await rekeyMutable(db, cipher));
  for (const u of await keyUsage(db)) console.log(`${u.table.padEnd(24)} ${u.mutable ? "mutable  " : "immutable"} key=${u.keyId} records=${u.records}`);
  console.log("Immutable records keep the key they were written with; do not remove a key while any immutable table still lists it.");
} finally { await db.pool.end(); }
