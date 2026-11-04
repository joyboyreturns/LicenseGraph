import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";

export type Transaction = PoolClient;

export class Database {
  constructor(readonly pool: Pool) {}
  static connect(url: string) {
    return new Database(
      new Pool({
        connectionString: url,
        max: 12,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        statement_timeout: 10_000,
        idle_in_transaction_session_timeout: 15_000,
      }),
    );
  }
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN");
      const result = await work(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
  }
  async migrate(directory = resolve(process.cwd(), "migrations")): Promise<void> {
    // Serializes migration runners; the schema and migration record commit together.
    await this.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(7102061104)");
      await tx.query(
        "CREATE TABLE IF NOT EXISTS public.licensegraph_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      await tx.query("ALTER TABLE public.licensegraph_migrations ADD COLUMN IF NOT EXISTS checksum text");
      const files = (await readdir(directory)).filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort();
      for (const file of files) {
        const version = Number(file.slice(0, 3));
        const sql = await readFile(resolve(directory, file), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const exists = (await tx.query("SELECT checksum FROM public.licensegraph_migrations WHERE version=$1", [version])).rows[0];
        if (exists) {
          if (exists.checksum && exists.checksum !== checksum) throw new Error(`Applied migration ${version} was changed.`);
          if (!exists.checksum)
            await tx.query("UPDATE public.licensegraph_migrations SET checksum=$1 WHERE version=$2", [checksum, version]);
          continue;
        }
        await tx.query(sql);
        await tx.query("INSERT INTO public.licensegraph_migrations(version,checksum) VALUES ($1,$2)", [version, checksum]);
      }
    });
  }
}
