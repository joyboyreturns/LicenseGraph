import { randomUUID } from "node:crypto";
import { paymentRequestId } from "../payments/request-id";
import { Database, type Transaction } from "./database";
import { RecordCipher } from "./crypto";
import { ConflictError } from "./runs";

export type OperationKind = "pipeline" | "order" | "capture" | "payout" | "refund" | "refresh" | "webhook";
export interface Operation {
  id: string; runId: string; kind: OperationKind; status: string; stage: string;
  leaseToken?: string; externalKey?: string; createdAt: Date; payload: unknown;
}

export class JobQueue {
  constructor(readonly db: Database, readonly cipher: RecordCipher) {}
  private decode(row: Record<string, any>): Operation {
    return { id: row.id, runId: row.run_id, kind: row.kind, status: row.status, stage: row.stage, leaseToken: row.lease_token ?? undefined,
      externalKey: row.external_key ?? undefined, createdAt: row.created_at, payload: row.sealed ? this.cipher.open(row.sealed, `operation:${row.id}`) : null };
  }
  async enqueue(tx: Transaction, runId: string, kind: OperationKind, dedupe: string, payload: unknown = null, availableAt = new Date()): Promise<Operation> {
    const id = randomUUID();
    const key = ["order","capture","payout","refund"].includes(kind) ? paymentRequestId(kind as "order" | "capture" | "payout" | "refund", `${runId}:${dedupe}`) : null;
    const result = await tx.query(`INSERT INTO licensegraph.operations(id,run_id,kind,dedupe_key,external_key,sealed,available_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (run_id,kind,dedupe_key) DO UPDATE SET available_at=CASE WHEN licensegraph.operations.status='queued' THEN LEAST(licensegraph.operations.available_at,EXCLUDED.available_at) ELSE licensegraph.operations.available_at END RETURNING *`,
    [id, runId, kind, dedupe, key, this.cipher.seal(payload, `operation:${id}`), availableAt]);
    return this.decode(result.rows[0]);
  }
  async claim(): Promise<Operation | undefined> {
    return this.db.transaction(async (tx) => {
      // An expired lease may have reached an external provider. It requires reconciliation, never blind replay.
      await tx.query("UPDATE licensegraph.operations SET status='reconcile',error_code='LEASE_EXPIRED',updated_at=now() WHERE status='running' AND lease_until < now()");
      for (let attempt = 0; attempt < 25; attempt++) {
        const selected = await tx.query(`SELECT o.* FROM licensegraph.operations o JOIN licensegraph.runs r ON r.id=o.run_id
          WHERE o.status='queued' AND o.available_at<=now() AND r.quarantine_reason IS NULL
          AND NOT EXISTS (SELECT 1 FROM licensegraph.operations busy WHERE busy.run_id=o.run_id AND busy.status IN ('running','reconcile'))
          ORDER BY o.available_at,o.created_at LIMIT 1 FOR UPDATE OF o,r SKIP LOCKED`);
        if (!selected.rowCount) return undefined;
        const row = selected.rows[0];
        // An unreadable job can never run. Failing it visibly keeps it from blocking every worker behind it.
        try { this.decode(row); }
        catch {
          await tx.query("UPDATE licensegraph.operations SET status='failed',error_code='UNREADABLE_RECORD',lease_until=NULL,updated_at=now() WHERE id=$1", [row.id]);
          console.error(JSON.stringify({ event: "operation_unreadable", operation: row.id }));
          continue;
        }
        const updated = await tx.query("UPDATE licensegraph.operations SET status='running',lease_token=$1,lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=$2 RETURNING *", [randomUUID(), row.id]);
        return this.decode(updated.rows[0]);
      }
      return undefined;
    });
  }
  async assertLease(tx: Transaction, job: Operation): Promise<void> {
    const result = await tx.query("SELECT id FROM licensegraph.operations WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_until>now() FOR UPDATE", [job.id, job.leaseToken]);
    if (!result.rowCount) throw new ConflictError("Operation lease expired. Reconciliation is required.");
  }
  async submitted(tx: Transaction, job: Operation): Promise<void> {
    await this.assertLease(tx, job);
    await tx.query("UPDATE licensegraph.operations SET stage='submitted',updated_at=now() WHERE id=$1", [job.id]);
  }
  async heartbeat(job: Operation): Promise<boolean> {
    const result = await this.db.pool.query("UPDATE licensegraph.operations SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now()", [job.id, job.leaseToken]);
    return result.rowCount === 1;
  }
  async finish(tx: Transaction, job: Operation, status: "succeeded" | "failed" | "reconcile", errorCode?: string): Promise<void> {
    await this.assertLease(tx, job);
    await tx.query("UPDATE licensegraph.operations SET status=$1,stage=CASE WHEN $1='succeeded' THEN 'recorded' ELSE stage END,error_code=$2,lease_until=NULL,updated_at=now() WHERE id=$3", [status, errorCode ?? null, job.id]);
  }
  async get(id: string): Promise<Operation | undefined> {
    const result = await this.db.pool.query("SELECT * FROM licensegraph.operations WHERE id=$1", [id]);
    return result.rows[0] ? this.decode(result.rows[0]) : undefined;
  }
}
