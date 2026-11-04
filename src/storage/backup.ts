import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyChain } from "../ledger/ledger";
import { deserializeSession, type StoredSession } from "../app-logic/persistence";
import { hashSecret, type RecordCipher } from "./crypto";
import type { Database } from "./database";

export interface BackupManifest {
  format: 1;
  createdAt: string;
  migrations: { version: number; checksum: string | null }[];
  tables: { name: string; rows: number; sha256: string }[];
}

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

/** Application tables in dependency order (parents first), from the live foreign keys. */
async function tableOrder(db: Database): Promise<string[]> {
  const tables = (await db.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='licensegraph' ORDER BY tablename")).rows.map((r) => r.tablename as string);
  const parents = new Map(tables.map((t) => [t, new Set<string>()]));
  const fks = await db.pool.query(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname='licensegraph'`);
  for (const { child, parent } of fks.rows) {
    const c = child.replace("licensegraph.", ""), p = parent.replace("licensegraph.", "");
    if (c !== p && parents.has(c) && parents.has(p)) parents.get(c)!.add(p);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < tables.length) {
    const ready = tables.filter((t) => !done.has(t) && [...parents.get(t)!].every((p) => done.has(p)));
    if (!ready.length) throw new Error("Cyclic table dependencies; cannot order a restore.");
    for (const t of ready) { ordered.push(t); done.add(t); }
  }
  return ordered;
}

/**
 * Writes one JSON-lines file per table plus a checksummed manifest. Records stay sealed: a backup holds ciphertext
 * only, so it is as sensitive as the database but needs no key to be written. Sessions and login attempts are
 * excluded because they are short-lived credentials that must not be resurrected from a backup.
 */
export async function backupDatabase(db: Database, directory: string): Promise<BackupManifest> {
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error("Choose an empty directory for the backup.");
  const skip = new Set(["auth_sessions", "login_attempts", "worker_heartbeats", "model_slots"]);
  const client = await db.pool.connect();
  try {
    // One snapshot for every table, so rows that reference each other are consistent.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables: BackupManifest["tables"] = [];
    for (const name of await tableOrder(db)) {
      if (skip.has(name)) continue;
      const rows = (await client.query(`SELECT row_to_json(t) AS r FROM licensegraph."${name}" t`)).rows.map((row) => JSON.stringify(row.r));
      const body = rows.length ? rows.join("\n") + "\n" : "";
      await writeFile(join(directory, `${name}.jsonl`), body);
      tables.push({ name, rows: rows.length, sha256: sha256(body) });
    }
    const migrations = (await client.query("SELECT version,checksum FROM public.licensegraph_migrations ORDER BY version")).rows;
    await client.query("COMMIT");
    const manifest: BackupManifest = { format: 1, createdAt: new Date().toISOString(), migrations, tables };
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

/** Loads a backup into an empty, already migrated database after checking every file against the manifest. */
export async function restoreDatabase(db: Database, directory: string): Promise<BackupManifest> {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as BackupManifest;
  if (manifest.format !== 1) throw new Error("Unsupported backup format.");
  const target = (await db.pool.query("SELECT version,checksum FROM public.licensegraph_migrations ORDER BY version")).rows;
  if (JSON.stringify(target) !== JSON.stringify(manifest.migrations)) throw new Error("The target database must be migrated to the same schema as the backup.");
  const bodies = new Map<string, string>();
  for (const table of manifest.tables) {
    const body = await readFile(join(directory, `${table.name}.jsonl`), "utf8");
    if (sha256(body) !== table.sha256) throw new Error(`Backup file for ${table.name} does not match its checksum.`);
    bodies.set(table.name, body);
  }
  await db.transaction(async (tx) => {
    for (const table of manifest.tables) {
      if ((await tx.query(`SELECT 1 FROM licensegraph."${table.name}" LIMIT 1`)).rowCount) throw new Error(`The target database is not empty (${table.name}).`);
    }
    for (const table of manifest.tables) {
      const rows = bodies.get(table.name)!.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      if (!rows.length) continue;
      await tx.query(`INSERT INTO licensegraph."${table.name}" SELECT * FROM json_populate_recordset(null::licensegraph."${table.name}", $1::json)`, [JSON.stringify(rows)]);
    }
  });
  return manifest;
}

export interface VerificationReport { runs: number; documents: number; ledgerEvents: number; authorizations: number; problems: string[] }

/**
 * Proves a database is internally sound using the encryption keys: every run opens, its ledger chain verifies and
 * matches the ledger table, documents match their recorded hashes, and every purchase authorization still hashes to
 * the digest bound into the approved ledger event.
 */
export async function verifyDatabase(db: Database, cipher: RecordCipher): Promise<VerificationReport> {
  const report: VerificationReport = { runs: 0, documents: 0, ledgerEvents: 0, authorizations: 0, problems: [] };
  const runs = await db.pool.query("SELECT id,sealed FROM licensegraph.runs ORDER BY id");
  for (const run of runs.rows) {
    report.runs += 1;
    try {
      const stored = cipher.open<StoredSession>(run.sealed, `run:${run.id}`);
      const session = deserializeSession(stored);
      const events = session.ledger.events();
      if (!verifyChain(events)) report.problems.push(`run ${run.id}: ledger chain is broken`);
      const rows = (await db.pool.query("SELECT seq,hash FROM licensegraph.ledger_events WHERE run_id=$1 ORDER BY seq", [run.id])).rows;
      report.ledgerEvents += rows.length;
      if (rows.length !== events.length || rows.some((r, i) => r.seq !== events[i]!.seq || r.hash !== events[i]!.hash)) report.problems.push(`run ${run.id}: ledger table differs from the run`);
      const docs = (await db.pool.query("SELECT document_id,content_hash,sealed FROM licensegraph.documents WHERE run_id=$1", [run.id])).rows;
      for (const d of docs) {
        report.documents += 1;
        const document = cipher.open<unknown>(d.sealed, `document:${run.id}:${d.document_id}`);
        if (hashSecret(JSON.stringify(document)) !== d.content_hash) report.problems.push(`run ${run.id}: document ${d.document_id} does not match its hash`);
      }
      const auths = (await db.pool.query("SELECT id,digest,sealed FROM licensegraph.purchase_authorizations WHERE run_id=$1", [run.id])).rows;
      for (const a of auths) {
        report.authorizations += 1;
        const authorization = cipher.open<unknown>(a.sealed, `authorization:${a.id}`);
        if (hashSecret(canonical(authorization)) !== a.digest) report.problems.push(`run ${run.id}: authorization ${a.id} does not match its digest`);
        const approved = events.find((e) => e.kind === "approved");
        if (approved && approved.payload.purchaseDigest !== undefined && approved.payload.purchaseDigest !== a.digest) report.problems.push(`run ${run.id}: ledger approval is bound to a different authorization`);
      }
    } catch { report.problems.push(`run ${run.id}: cannot be opened with the configured keys`); }
  }
  return report;
}
import { canonicalJson as canonical } from "../core/digest";
