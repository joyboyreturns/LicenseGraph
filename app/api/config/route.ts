import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

export function GET() {
  const { mode, model, paymentsEnabled, llmProxy } = getRuntime();
  return json({ mode, model, paymentsEnabled, assistant: Boolean(llmProxy) });
}
