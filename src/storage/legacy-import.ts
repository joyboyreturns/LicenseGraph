import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { deserializeSession, type StoredSession } from "../app-logic/persistence";
import { hashSecret } from "./crypto";
import type { Database } from "./database";
import type { RunRepository } from "./runs";

export interface ImportOutcome {
  file: string;
  status: "imported" | "quarantined" | "skipped";
  reason?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Imports anonymous-mode JSON runs into PostgreSQL. Idempotent: a file is identified by the hash of its bytes, so a
 * second run imports nothing twice. A file that cannot be trusted (unreadable, wrong shape, broken ledger chain,
 * non-UUID id, or an id already used by different content) is recorded as quarantined and copied to <dir>/quarantine.
 * Originals are never modified or deleted. Imported runs have no account owner: the browser that created one links it,
 * or staff assign it with a recorded reason.
 */
export async function importLegacyRuns(
  db: Database,
  runs: RunRepository,
  directory: string,
  options: { dryRun?: boolean } = {},
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    const path = join(directory, name);
    const bytes = await readFile(path);
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const seen = (await db.pool.query("SELECT status FROM licensegraph.import_records WHERE source_hash=$1", [sourceHash])).rows[0];
    if (seen) {
      outcomes.push({ file: name, status: "skipped", reason: `already ${seen.status}` });
      continue;
    }

    let reason: string | undefined;
    let session: ReturnType<typeof deserializeSession> | undefined;
    try {
      const stored = JSON.parse(bytes.toString("utf8")) as StoredSession;
      if (stored.v !== 1 || typeof stored.id !== "string") reason = "Not a LicenseGraph run file.";
      else if (!UUID.test(stored.id)) reason = "Run id is not a UUID.";
      else {
        // Rebuilding the session rebuilds the ledger and rejects a broken hash chain.
        session = deserializeSession(stored);
      }
    } catch {
      reason = "The file is unreadable or its ledger chain does not verify.";
    }

    if (session && !reason && (await db.pool.query("SELECT 1 FROM licensegraph.runs WHERE id=$1", [session.id])).rowCount)
      reason = "A different run already uses this id.";

    if (reason || !session) {
      outcomes.push({ file: name, status: "quarantined", reason });
      if (options.dryRun) continue;
      await mkdir(join(directory, "quarantine"), { recursive: true });
      await copyFile(path, join(directory, "quarantine", name));
      await db.pool.query(
        "INSERT INTO licensegraph.import_records(source_hash,status,reason) VALUES ($1,'quarantined',$2) ON CONFLICT DO NOTHING",
        [sourceHash, reason],
      );
      continue;
    }

    outcomes.push({ file: name, status: "imported" });
    if (options.dryRun) continue;
    const imported = session;
    await db.transaction(async (tx) => {
      await runs.create(imported, null, tx, imported.ownerId ? hashSecret(imported.ownerId) : undefined);
      await tx.query("INSERT INTO licensegraph.import_records(source_hash,run_id,status) VALUES ($1,$2,'imported')", [
        sourceHash,
        imported.id,
      ]);
      await runs.audit(tx, null, "legacy_run_imported", imported.id, { sourceHash, importId: randomUUID() });
    });
  }
  return outcomes;
}
