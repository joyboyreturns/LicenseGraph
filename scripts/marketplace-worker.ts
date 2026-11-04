import { getPrivateRuntime } from "../src/marketplace/runtime";
const runtime = getPrivateRuntime();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });
try {
  while (!stopping) {
    try { if (!(await runtime.worker.once())) await new Promise((resolve) => setTimeout(resolve, 1000)); }
    catch { console.error(JSON.stringify({ event: "worker_unavailable" })); await new Promise((resolve) => setTimeout(resolve, 3000)); }
  }
} finally { await runtime.db.pool.end(); }
