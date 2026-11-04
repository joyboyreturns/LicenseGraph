import { randomUUID } from "node:crypto";
import { getPrivateRuntime } from "../src/marketplace/runtime";
import { processPendingWebhooks } from "../src/marketplace/webhooks";
const runtime = getPrivateRuntime();
let stopping = false;
const workerId = randomUUID();
let lastBeat = 0;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
try {
  while (!stopping) {
    try {
      if (Date.now() - lastBeat > 10_000) {
        await runtime.db.pool.query("INSERT INTO licensegraph.worker_heartbeats(worker_id) VALUES ($1) ON CONFLICT (worker_id) DO UPDATE SET beat_at=now()", [workerId]);
        await runtime.db.pool.query("DELETE FROM licensegraph.worker_heartbeats WHERE beat_at < now() - interval '1 day'");
        await processPendingWebhooks(runtime);
        lastBeat = Date.now();
      }
      if (!(await runtime.worker.once())) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    catch { console.error(JSON.stringify({ event: "worker_unavailable" })); await new Promise((resolve) => setTimeout(resolve, 3000)); }
  }
} finally { await runtime.db.pool.end(); }
