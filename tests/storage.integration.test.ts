import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../src/app-logic/session";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";
import { RecordCipher } from "../src/storage/crypto";
import { Database } from "../src/storage/database";
import { JobQueue } from "../src/storage/jobs";
import { RunRepository } from "../src/storage/runs";

const enabled = process.env.RUN_DATABASE_TESTS === "1";
describe.skipIf(!enabled)("PostgreSQL durable storage", () => {
  const db = enabled ? Database.connect(process.env.DATABASE_URL!) : undefined!;
  const cipher = new RecordCipher("test", { test: "ab".repeat(32) });
  const runs = new RunRepository(db, cipher);
  const queue = new JobQueue(db, cipher);
  let userId: string;
  const input = () => ({ project: sampleProject, documents: sampleDocuments, requiredAssetIds: sampleRequiredAssets });
  const make = async () => {
    const session = createSession(input());
    await db.transaction((tx) => runs.create(session, userId, tx));
    return session;
  };
  beforeAll(async () => {
    await db.migrate(); await db.migrate();
    userId = randomUUID();
    await db.pool.query("INSERT INTO licensegraph.users(id,issuer,subject,email,display_name) VALUES ($1,'fixture',$2,'fixture@example.invalid','Fixture')", [userId, userId]);
  });
  afterAll(async () => { if (db) await db.pool.end(); });

  it("persists encrypted documents and detects stale revisions", async () => {
    const session = await make();
    const first = (await runs.read(session.id))!;
    const stale = (await runs.read(session.id))!;
    first.session.phase = "extracting";
    await db.transaction((tx) => runs.save(first, tx));
    expect((await runs.read(session.id))!.session.phase).toBe("extracting");
    await expect(db.transaction((tx) => runs.save(stale, tx))).rejects.toThrow(/changed/);
    const row = (await db.pool.query("SELECT sealed FROM licensegraph.documents WHERE run_id=$1 LIMIT 1", [session.id])).rows[0];
    expect(row.sealed).not.toContain(sampleDocuments[0]!.text);
  });
  it("commits ledger and state together, and refuses historical edits", async () => {
    const session = await make();
    const loaded = (await runs.read(session.id))!;
    loaded.session.ledger.append("proposed", { fixture: true });
    await db.transaction((tx) => runs.save(loaded, tx));
    const count = (await db.pool.query("SELECT count(*) FROM licensegraph.ledger_events WHERE run_id=$1", [session.id])).rows[0].count;
    expect(count).toBe("1");
    await expect(db.pool.query("DELETE FROM licensegraph.ledger_events WHERE run_id=$1", [session.id])).rejects.toThrow(/immutable/);
    await expect(db.transaction(async (tx) => { loaded.session.phase = "failed"; await runs.save(loaded, tx); throw new Error("rollback"); })).rejects.toThrow(/rollback/);
    expect((await runs.read(session.id))!.session.phase).toBe("created");
  });
  it("deduplicates queued requests and only one worker owns a run", async () => {
    const session = await make();
    const [a, b] = await Promise.all([db.transaction((tx) => queue.enqueue(tx, session.id, "order", "one")), db.transaction((tx) => queue.enqueue(tx, session.id, "order", "one"))]);
    expect(a.id).toBe(b.id);
    const claimFor = async () => {
      const job = await queue.claim();
      if (job && job.runId !== session.id) {
        await db.transaction((tx) => queue.finish(tx, job, "failed"));
        return claimFor();
      }
      return job;
    };
    const claims = await Promise.all([claimFor(), claimFor()]);
    const owned = claims.filter(Boolean);
    expect(owned).toHaveLength(1);
    const job = owned[0]!;
    await db.pool.query("UPDATE licensegraph.operations SET lease_until=now()-interval '1 second' WHERE id=$1", [job.id]);
    await queue.claim();
    expect((await queue.get(job.id))!.status).toBe("reconcile");
    await expect(db.transaction((tx) => queue.submitted(tx, job))).rejects.toThrow(/lease expired/);
  });
  it("rejects negative, fractional and unsafe cents in the database", async () => {
    for (const value of ["-1", "1.5", "9007199254740992"]) await expect(db.pool.query("SELECT $1::licensegraph.cents", [value])).rejects.toThrow();
  });

  it("fails an unreadable job visibly instead of letting it block every worker", async () => {
    const poisoned = await make();
    const healthy = await make();
    const foreign = new RecordCipher("other", { other: "ab".repeat(32) });
    const badId = randomUUID();
    await db.pool.query("INSERT INTO licensegraph.operations(id,run_id,kind,dedupe_key,sealed,available_at) VALUES ($1,$2,'pipeline','initial',$3,now()-interval '1 hour')", [badId, poisoned.id, foreign.seal(null, `operation:${badId}`)]);
    const good = await db.transaction((tx) => queue.enqueue(tx, healthy.id, "pipeline", "initial"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let claimed = await queue.claim();
      while (claimed && claimed.id !== good.id) { await db.transaction((tx) => queue.finish(tx, claimed!, "failed")); claimed = await queue.claim(); }
      expect(claimed?.id).toBe(good.id);
    } finally { errors.mockRestore(); }
    const bad = await db.pool.query("SELECT status,error_code FROM licensegraph.operations WHERE id=$1", [badId]);
    expect(bad.rows[0]).toMatchObject({ status: "failed", error_code: "UNREADABLE_RECORD" });
  });
});
