import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../src/app-logic/session";
import { serializeSession } from "../src/app-logic/persistence";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";
import { backupDatabase, restoreDatabase, verifyDatabase } from "../src/storage/backup";
import { RecordCipher } from "../src/storage/crypto";
import { Database } from "../src/storage/database";
import { importLegacyRuns } from "../src/storage/legacy-import";
import { keyUsage, rekeyMutable } from "../src/storage/rekey";
import { RunRepository } from "../src/storage/runs";

const enabled = process.env.RUN_DATABASE_TESTS === "1";

/** A sibling database on the same server, recreated empty. */
async function freshDatabase(suffix: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const url = new URL(process.env.DATABASE_URL!);
  const name = `${decodeURIComponent(url.pathname.slice(1))}_${suffix}`;
  const maintenance = new URL(url); maintenance.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  url.pathname = `/${name}`;
  return { url: url.toString(), drop: async () => { const a = new pg.Client({ connectionString: maintenance.toString() }); await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await a.end(); } };
}

describe.skipIf(!enabled)("legacy import, backup and restore", () => {
  const cipher = new RecordCipher("ops", { ops: "ef".repeat(32) });
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const c of cleanups.reverse()) await c(); });
  const newSession = (ownerId?: string) => {
    const s = createSession({ project: sampleProject, requiredAssetIds: sampleRequiredAssets, documents: sampleDocuments });
    s.ownerId = ownerId;
    s.ledger.append("extracted", { note: "fixture" });
    return s;
  };
  async function target(suffix: string) {
    const fresh = await freshDatabase(suffix);
    cleanups.push(fresh.drop);
    const db = Database.connect(fresh.url);
    cleanups.push(async () => { await db.pool.end(); });
    await db.migrate();
    return { db, runs: new RunRepository(db, cipher) };
  }

  describe("importer", () => {
    let dir: string;
    beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "legacy-")); });

    it("imports valid runs once, keeps owner hashes, and quarantines untrustworthy files without touching originals", async () => {
      const { db, runs } = await target("import");
      const good = newSession("legacy-owner-123456");
      await writeFile(join(dir, `${good.id}.json`), JSON.stringify(serializeSession(good)));
      const tampered = serializeSession(newSession());
      tampered.events = tampered.events.map((e, i) => (i === 0 ? { ...e, payload: { ...e.payload, forged: true } } : e));
      await writeFile(join(dir, "tampered.json"), JSON.stringify(tampered));
      await writeFile(join(dir, "garbage.json"), "{ not json");
      await writeFile(join(dir, "wrong-id.json"), JSON.stringify({ ...serializeSession(newSession()), id: "not-a-uuid-at-all" }));
      const before = await Promise.all((await readdir(dir)).filter((n) => n.endsWith(".json")).map(async (n) => [n, await readFile(join(dir, n), "utf8")] as const));

      const dry = await importLegacyRuns(db, runs, dir, { dryRun: true });
      expect(dry.filter((o) => o.status === "imported")).toHaveLength(1);
      expect((await db.pool.query("SELECT count(*)::int AS n FROM licensegraph.runs")).rows[0].n).toBe(0);
      expect((await readdir(dir)).includes("quarantine")).toBe(false);

      const first = await importLegacyRuns(db, runs, dir);
      expect(first.filter((o) => o.status === "imported").map((o) => o.file)).toEqual([`${good.id}.json`]);
      expect(first.filter((o) => o.status === "quarantined").map((o) => o.file).sort()).toEqual(["garbage.json", "tampered.json", "wrong-id.json"]);
      const row = (await db.pool.query("SELECT owner_id,legacy_owner_hash FROM licensegraph.runs WHERE id=$1", [good.id])).rows[0];
      expect(row.owner_id).toBeNull();
      expect(row.legacy_owner_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.legacy_owner_hash).not.toContain("legacy-owner");
      expect((await readdir(join(dir, "quarantine"))).sort()).toEqual(["garbage.json", "tampered.json", "wrong-id.json"]);

      const second = await importLegacyRuns(db, runs, dir);
      expect(second.every((o) => o.status === "skipped")).toBe(true);
      expect((await db.pool.query("SELECT count(*)::int AS n FROM licensegraph.runs")).rows[0].n).toBe(1);

      for (const [name, text] of before) expect(await readFile(join(dir, name), "utf8")).toBe(text);
      expect((await verifyDatabase(db, cipher)).problems).toEqual([]);
    });

    it("quarantines a different file that reuses an imported run id", async () => {
      const { db, runs } = await target("import2");
      const original = newSession();
      const folder = await mkdtemp(join(tmpdir(), "legacy-dup-"));
      await writeFile(join(folder, "a.json"), JSON.stringify(serializeSession(original)));
      expect((await importLegacyRuns(db, runs, folder))[0]!.status).toBe("imported");
      const changed = { ...serializeSession(original), failure: "different bytes" };
      await writeFile(join(folder, "b.json"), JSON.stringify(changed));
      const outcome = await importLegacyRuns(db, runs, folder);
      expect(outcome.find((o) => o.file === "b.json")).toMatchObject({ status: "quarantined", reason: "A different run already uses this id." });
    });
  });

  describe("backup and restore", () => {
    it("restores into an isolated empty database with documents, authorizations and ledger chains intact, and detects tampering", async () => {
      const source = await target("backup_src");
      const a = newSession();
      const owner = randomUUID();
      await source.db.pool.query("INSERT INTO licensegraph.users(id,issuer,subject,email,display_name,roles) VALUES ($1,'fixture',$2,$3,'Owner',ARRAY['buyer'])", [owner, owner, `${owner}@example.invalid`]);
      await source.db.transaction(async (tx) => { await source.runs.create(a, owner, tx); await source.runs.audit(tx, owner, "fixture", a.id, {}); });
      // A captured purchase with a bound authorization digest.
      const authId = randomUUID();
      const authorization = { version: 3, runId: a.id, note: "fixture authorization" };
      const { canonicalJson } = await import("../src/core/digest");
      const { hashSecret } = await import("../src/storage/crypto");
      const digest = hashSecret(canonicalJson(authorization));
      await source.db.pool.query("INSERT INTO licensegraph.purchase_authorizations(id,run_id,approved_by,digest,amount_cents,currency,sealed) VALUES ($1,$2,$3,$4,100,'USD',$5)", [authId, a.id, owner, digest, cipher.seal(authorization, `authorization:${authId}`)]);
      await source.db.pool.query("INSERT INTO licensegraph.auth_sessions(token_hash,user_id,expires_at) VALUES ('t',$1,now()+interval '1 hour')", [owner]);

      const folder = await mkdtemp(join(tmpdir(), "backup-"));
      const manifest = await backupDatabase(source.db, folder);
      expect(manifest.tables.map((t) => t.name)).not.toContain("auth_sessions");
      // Ciphertext only: no licence text appears in any backup file.
      for (const file of await readdir(folder)) expect(await readFile(join(folder, file), "utf8")).not.toContain(sampleDocuments[0]!.text.slice(0, 40));
      await expect(backupDatabase(source.db, folder)).rejects.toThrow(/empty directory/);

      const restored = await target("backup_dst");
      await restoreDatabase(restored.db, folder);
      const report = await verifyDatabase(restored.db, cipher);
      expect(report.problems).toEqual([]);
      expect(report).toMatchObject({ runs: 1, authorizations: 1 });
      expect(report.documents).toBe(sampleDocuments.length);
      expect(report.ledgerEvents).toBe(a.ledger.events().length);
      expect((await restored.db.pool.query("SELECT count(*)::int AS n FROM licensegraph.auth_sessions")).rows[0].n).toBe(0);
      expect((await restored.runs.read(a.id))!.session.ledger.events().map((e) => e.hash)).toEqual(a.ledger.events().map((e) => e.hash));

      // Restoring again, into a non-empty database, is refused.
      await expect(restoreDatabase(restored.db, folder)).rejects.toThrow(/not empty/);
      // The wrong key cannot open anything, and says so.
      const wrongKey = await verifyDatabase(restored.db, new RecordCipher("other", { other: "12".repeat(32) }));
      expect(wrongKey.problems.length).toBeGreaterThan(0);

      // A changed backup file fails its checksum before anything is written.
      const empty = await target("backup_dst2");
      const ledgerFile = join(folder, "ledger_events.jsonl");
      await writeFile(ledgerFile, (await readFile(ledgerFile, "utf8")).replace(/"seq":1,/, '"seq":9,'));
      await expect(restoreDatabase(empty.db, folder)).rejects.toThrow(/checksum/);
      expect((await empty.db.pool.query("SELECT count(*)::int AS n FROM licensegraph.runs")).rows[0].n).toBe(0);

      // A tampered authorization inside a restored database is detected by verification.
      await restored.db.pool.query("ALTER TABLE licensegraph.purchase_authorizations DISABLE TRIGGER immutable_authorizations");
      await restored.db.pool.query("UPDATE licensegraph.purchase_authorizations SET digest=(CASE WHEN left(digest,1)='0' THEN '1' ELSE '0' END)||substr(digest,2)");
      expect((await verifyDatabase(restored.db, cipher)).problems.join(" ")).toMatch(/authorization .* does not match its digest/);
    });
  });

  describe("key rotation", () => {
    it("moves mutable records to the new key, keeps immutable ones readable under the retained old key, and never overwrites a concurrent write", async () => {
      const { db, runs } = await target("rekey");
      const both = new RecordCipher("ops2", { ops: "ef".repeat(32), ops2: "01".repeat(32) });
      const first = newSession();
      first.ledger.append("extracted", { note: "fixture" });
      await db.transaction((tx) => runs.create(first, null, tx));
      expect((await keyUsage(db)).every((u) => u.keyId === "ops")).toBe(true);

      expect(await rekeyMutable(db, both)).toMatchObject({ resealed: 1, unreadable: 0 });
      const after = await keyUsage(db);
      expect(after.find((u) => u.table === "runs")).toMatchObject({ keyId: "ops2" });
      expect(after.filter((u) => !u.mutable).every((u) => u.keyId === "ops")).toBe(true);
      expect((await verifyDatabase(db, both)).problems).toEqual([]);
      expect((await rekeyMutable(db, both)).resealed).toBe(0);
      // Dropping the old key breaks exactly what is still sealed with it, and says so.
      expect((await verifyDatabase(db, new RecordCipher("ops2", { ops2: "01".repeat(32) }))).problems.length).toBeGreaterThan(0);

      // A row rewritten between the read and the update is skipped, never overwritten.
      const racing = newSession();
      racing.ledger.append("extracted", { note: "race" });
      await db.transaction((tx) => runs.create(racing, null, tx));
      const original = (await db.pool.query("SELECT sealed FROM licensegraph.runs WHERE id=$1", [racing.id])).rows[0].sealed as string;
      const concurrent = both.seal({ ...cipher.open<object>(original, `run:${racing.id}`), failure: "written meanwhile" }, `run:${racing.id}`);
      const realQuery = db.pool.query.bind(db.pool) as (...args: unknown[]) => Promise<unknown>;
      let injected = false;
      (db.pool as unknown as { query: unknown }).query = async (...args: unknown[]) => {
        if (!injected && typeof args[0] === "string" && args[0].startsWith('UPDATE licensegraph."runs" SET sealed')) {
          injected = true;
          await realQuery("UPDATE licensegraph.runs SET sealed=$1 WHERE id=$2", [concurrent, racing.id]);
        }
        return realQuery(...args);
      };
      const pass = await rekeyMutable(db, both);
      (db.pool as unknown as { query: unknown }).query = realQuery;
      expect(injected).toBe(true);
      expect(pass.skipped).toBe(1);
      const finalRow = (await db.pool.query("SELECT sealed FROM licensegraph.runs WHERE id=$1", [racing.id])).rows[0].sealed as string;
      expect(both.open<{ failure?: string }>(finalRow, `run:${racing.id}`).failure).toBe("written meanwhile");
    });
  });
});
