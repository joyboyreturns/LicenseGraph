import { Database } from "./database";

/** Reserve a shared start slot before checking prices; no transaction spans the wait or request. */
export async function reserveModelSlot(db: Database, key: string, intervalMs: number): Promise<void> {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error("Model request interval must be positive.");
  const delay = await db.transaction(async (tx) => {
    await tx.query("INSERT INTO licensegraph.rate_slots(key,next_at) VALUES ($1,now()) ON CONFLICT DO NOTHING", [key]);
    const result = await tx.query("SELECT GREATEST(0,EXTRACT(EPOCH FROM (next_at-now()))*1000)::float8 AS delay FROM licensegraph.rate_slots WHERE key=$1 FOR UPDATE", [key]);
    const wait = Math.ceil(result.rows[0].delay);
    if (wait > 60_000) throw new Error("The shared model queue is full. Try again later.");
    await tx.query("UPDATE licensegraph.rate_slots SET next_at=GREATEST(next_at,now())+($2 * interval '1 millisecond') WHERE key=$1", [key, intervalMs]);
    return wait;
  });
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
}
