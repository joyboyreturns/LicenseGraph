import { randomUUID } from "node:crypto";
import { deserializeSession, serializeSession, type StoredSession } from "../app-logic/persistence";
import type { Session } from "../app-logic/session";
import { verifyChain } from "../ledger/ledger";
import { RecordCipher, hashSecret } from "./crypto";
import { Database, type Transaction } from "./database";

export class ConflictError extends Error {}
export interface StoredRun {
  session: Session;
  revision: number;
  ownerId: string | null;
}

export class RunRepository {
  constructor(
    readonly db: Database,
    readonly cipher: RecordCipher,
  ) {}
  async read(id: string, tx?: Transaction): Promise<StoredRun | undefined> {
    const result = await (tx ?? this.db.pool).query(
      "SELECT sealed, revision, owner_id FROM licensegraph.runs WHERE id = $1 AND quarantine_reason IS NULL",
      [id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const stored = this.cipher.open<StoredSession>(row.sealed, `run:${id}`);
    if (stored.id !== id) throw new Error("Stored run identity mismatch.");
    return { session: deserializeSession(stored, { resume: true }), revision: row.revision, ownerId: row.owner_id };
  }
  async lock(id: string, tx: Transaction): Promise<StoredRun> {
    await tx.query("SELECT id FROM licensegraph.runs WHERE id = $1 FOR UPDATE", [id]);
    const loaded = await this.read(id, tx);
    if (!loaded) throw new ConflictError("Run not found.");
    return loaded;
  }
  async create(session: Session, ownerId: string | null, tx: Transaction, legacyOwnerHash?: string): Promise<void> {
    await tx.query("INSERT INTO licensegraph.runs(id,owner_id,legacy_owner_hash,phase,sealed,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [
      session.id,
      ownerId,
      legacyOwnerHash ?? null,
      session.phase,
      this.cipher.seal(serializeSession(session), `run:${session.id}`),
      session.createdAt,
    ]);
    for (const document of session.input.documents) {
      await tx.query("INSERT INTO licensegraph.documents(run_id,document_id,content_hash,sealed) VALUES ($1,$2,$3,$4)", [
        session.id,
        document.id,
        hashSecret(JSON.stringify(document)),
        this.cipher.seal(document, `document:${session.id}:${document.id}`),
      ]);
    }
    await this.appendEvents(session, tx);
  }
  async save(loaded: StoredRun, tx: Transaction): Promise<void> {
    const { session, revision } = loaded;
    if (!verifyChain(session.ledger.events())) throw new ConflictError("Run ledger is invalid.");
    const updated = await tx.query(
      "UPDATE licensegraph.runs SET phase=$1,sealed=$2,revision=revision+1,updated_at=now() WHERE id=$3 AND revision=$4 RETURNING revision",
      [session.phase, this.cipher.seal(serializeSession(session), `run:${session.id}`), session.id, revision],
    );
    if (updated.rowCount !== 1) throw new ConflictError("The run changed. Refresh before trying again.");
    const documents = await tx.query("SELECT document_id,content_hash FROM licensegraph.documents WHERE run_id=$1", [session.id]);
    if (
      documents.rows.length !== session.input.documents.length ||
      documents.rows.some(
        (row) => hashSecret(JSON.stringify(session.input.documents.find((doc) => doc.id === row.document_id))) !== row.content_hash,
      )
    ) {
      throw new ConflictError("Source documents are immutable. Start a linked run for revised terms.");
    }
    await this.appendEvents(session, tx);
    loaded.revision = updated.rows[0].revision;
  }
  private async appendEvents(session: Session, tx: Transaction) {
    const existing = await tx.query("SELECT seq,hash FROM licensegraph.ledger_events WHERE run_id=$1 ORDER BY seq", [session.id]);
    const events = session.ledger.events();
    if (
      !verifyChain(events) ||
      existing.rows.length > events.length ||
      existing.rows.some((row, index) => row.seq !== events[index]?.seq || row.hash !== events[index]?.hash)
    )
      throw new ConflictError("Recorded ledger history cannot be changed.");
    for (const event of events.slice(existing.rows.length)) {
      await tx.query("INSERT INTO licensegraph.ledger_events(run_id,seq,hash,sealed) VALUES ($1,$2,$3,$4)", [
        session.id,
        event.seq,
        event.hash,
        this.cipher.seal(event, `event:${session.id}:${event.seq}`),
      ]);
    }
  }
  async audit(tx: Transaction, actor: string | null, action: string, resource: string, payload: unknown) {
    const id = randomUUID();
    await tx.query("INSERT INTO licensegraph.audit_events(id,actor_id,action,resource_id,sealed) VALUES ($1,$2,$3,$4,$5)", [
      id,
      actor,
      action,
      resource,
      this.cipher.seal(payload, `audit:${id}`),
    ]);
  }
}
