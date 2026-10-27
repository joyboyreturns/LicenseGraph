import { json } from "@/src/server/http";
import { ProxyError } from "@/src/server/llm-proxy";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** The dashboard assistant's only door to the model. The gateway key and model never reach the browser. */
export async function POST(req: Request) {
  const { llmProxy } = getRuntime();
  if (!llmProxy) return json({ error: "The assistant needs live mode: set AI_GATEWAY_API_KEY and a free LICENSEGRAPH_MODEL." }, 503);
  try {
    return json(await llmProxy(await req.json().catch(() => null)));
  } catch (e) {
    if (e instanceof ProxyError) return json({ error: e.message }, e.status);
    return json({ error: "The assistant could not reach the model." }, 502);
  }
}
