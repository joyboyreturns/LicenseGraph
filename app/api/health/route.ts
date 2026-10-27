import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** For uptime checks and for confirming a deployment picked up its settings. Reveals no secrets. */
export function GET() {
  const { mode, paymentsMode, store } = getRuntime();
  return json({ ok: true, mode, paymentsMode, runs: store.list().length });
}
