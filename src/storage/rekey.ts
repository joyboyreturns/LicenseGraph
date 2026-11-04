import { RecordCipher } from "./crypto";
import type { Database } from "./database";

interface SealedTable { table: string; keys: string[]; identity: (row: Record<string, any>) => string; mutable: boolean }

/**
 * Every table that holds an encrypted envelope and the identity it is bound to. Immutable tables cannot be updated
 * (a database trigger refuses it, by design), so their envelopes keep the key they were written with. That key must
 * stay configured for decryption for as long as those records exist.
 */
export const SEALED_TABLES: SealedTable[] = [
  { table: "runs", keys: ["id"], identity: (r) => `run:${r.id}`, mutable: true },
  { table: "operations", keys: ["id"], identity: (r) => `operation:${r.id}`, mutable: true },
  { table: "licensors", keys: ["id", "version"], identity: (r) => `licensor:${r.id}:${r.version}`, mutable: true },
  { table: "purchases", keys: ["run_id"], identity: (r) => `purchase:${r.run_id}`, mutable: true },
  { table: "disputes", keys: ["id"], identity: (r) => `dispute:${r.id}`, mutable: true },
  { table: "webhook_deliveries", keys: ["event_id"], identity: (r) => `webhook:${r.event_id}`, mutable: true },
  { table: "offers", keys: ["id", "version"], identity: (r) => `offer:${r.id}:${r.version}`, mutable: false },
  { table: "ledger_events", keys: ["run_id", "seq"], identity: (r) => `event:${r.run_id}:${r.seq}`, mutable: false },
  { table: "documents", keys: ["run_id", "document_id"], identity: (r) => `document:${r.run_id}:${r.document_id}`, mutable: false },
  { table: "purchase_authorizations", keys: ["id"], identity: (r) => `authorization:${r.id}`, mutable: false },
  { table: "audit_events", keys: ["id"], identity: (r) => `audit:${r.id}`, mutable: false },
];

export interface KeyUsage { table: string; mutable: boolean; keyId: string; records: number }

/** Which key seals how many records in each table. A retired key is safe to remove only when this shows none. */
export async function keyUsage(db: Database): Promise<KeyUsage[]> {
  const usage: KeyUsage[] = [];
  for (const t of SEALED_TABLES) {
    const rows = await db.pool.query(`SELECT split_part(sealed,'.',2) AS key_id, count(*)::int AS records FROM licensegraph."${t.table}" WHERE sealed IS NOT NULL GROUP BY 1 ORDER BY 1`);
    for (const row of rows.rows) usage.push({ table: t.table, mutable: t.mutable, keyId: row.key_id, records: row.records });
  }
  return usage;
}

/**
 * Re-seals mutable records that use an older key with the current one. Each update only applies if the stored envelope
 * is still the one that was read, so a concurrent write is never overwritten; such a row is left for the next pass.
 */
export async function rekeyMutable(db: Database, cipher: RecordCipher, batch = 200): Promise<{ resealed: number; skipped: number; unreadable: number }> {
  const result = { resealed: 0, skipped: 0, unreadable: 0 };
  for (const t of SEALED_TABLES.filter((x) => x.mutable)) {
    const skippedRows = new Set<string>();
    for (;;) {
      const rows = (await db.pool.query(`SELECT ${t.keys.map((c) => `"${c}"`).join(",")}, sealed FROM licensegraph."${t.table}" WHERE sealed IS NOT NULL AND split_part(sealed,'.',2) <> $1 LIMIT $2`, [cipher.currentKeyId, batch + skippedRows.size])).rows;
      const pending = rows.filter((row) => !skippedRows.has(t.identity(row)));
      if (!pending.length) break;
      for (const row of pending) {
        const identity = t.identity(row);
        let fresh: string;
        try { fresh = cipher.reseal(row.sealed, identity); } catch { result.unreadable += 1; skippedRows.add(identity); continue; }
        const where = t.keys.map((k, i) => `"${k}"=$${i + 3}`).join(" AND ");
        const updated = await db.pool.query(`UPDATE licensegraph."${t.table}" SET sealed=$1 WHERE ${where} AND sealed=$2`, [fresh, row.sealed, ...t.keys.map((k) => row[k])]);
        if (updated.rowCount) result.resealed += 1;
        else { result.skipped += 1; skippedRows.add(identity); }
      }
    }
  }
  return result;
}
