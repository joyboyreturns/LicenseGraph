/** The only thing the agent layer needs from a language model. Swap providers by swapping this. */
export interface ModelClient {
  complete(input: { system: string; user: string }): Promise<string>;
}

export interface GatewayConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  fetch?: typeof fetch;
  /** Minimum gap between the starts of two requests, to stay inside the provider's rate limit. */
  minIntervalMs?: number;
  /** Injectable for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Free models are typically limited to about 5 requests a minute (LICENSEGRAPH_MODEL_RPM overrides). */
export function minIntervalFromEnv(env: Record<string, string | undefined> = process.env): number {
  const rpm = Number(env.LICENSEGRAPH_MODEL_RPM);
  return Math.ceil(60_000 / (rpm > 0 ? rpm : 5)) + 500;
}

export function gatewayConfigFromEnv(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const { AI_GATEWAY_API_KEY: apiKey, LICENSEGRAPH_MODEL: model } = env;
  if (!apiKey || !model) throw new Error("AI_GATEWAY_API_KEY and LICENSEGRAPH_MODEL must be set");
  return { apiKey, model, minIntervalMs: minIntervalFromEnv(env) };
}

/**
 * Credits are limited, so no completion request is ever sent for a model the gateway does not
 * list as free (zero input and output price). Unknown models and missing prices count as paid.
 */
export async function assertModelIsFree(config: GatewayConfig): Promise<void> {
  const doFetch = config.fetch ?? fetch;
  const res = await doFetch(`${config.baseUrl ?? "https://ai-gateway.vercel.sh"}/v1/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) throw new Error(`Could not check model pricing (${res.status}); not sending any request`);
  const { data } = (await res.json()) as { data?: { id: string; pricing?: { input?: string | number; output?: string | number } }[] };
  const entry = data?.find((m) => m.id === config.model);
  if (!entry) throw new Error(`Model ${config.model} is not in the gateway list; refusing to send a request`);
  const price = (v: string | number | undefined) => (v === undefined || v === null || v === "" ? NaN : Number(v));
  if (price(entry.pricing?.input) !== 0 || price(entry.pricing?.output) !== 0) {
    throw new Error(`Model ${config.model} is not free; refusing to spend credits`);
  }
}

/** Vercel AI Gateway, OpenAI-compatible chat completions. Free models only. */
export function createGatewayModel(config: GatewayConfig): ModelClient {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? Date.now;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let checked: Promise<void> | undefined;
  let nextSlot = 0;
  return {
    async complete({ system, user }) {
      // A failed check is retried on the next call, never cached: one blip on the price list must not
      // disable the model until a restart. The check still has to pass before any completion is sent.
      checked ??= assertModelIsFree(config).catch((e) => {
        checked = undefined;
        throw e;
      });
      await checked;
      // Take the next free slot so several calls in a row never outrun the provider's rate limit.
      const slot = Math.max(now(), nextSlot);
      nextSlot = slot + (config.minIntervalMs ?? 0);
      if (slot > now()) await sleep(slot - now());
      const res = await doFetch(`${config.baseUrl ?? "https://ai-gateway.vercel.sh"}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          // Generous: reasoning models spend tokens thinking before they answer.
          max_tokens: config.maxTokens ?? 16000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (!res.ok) throw new Error(`AI Gateway request failed: ${res.status} ${body.error?.message ?? ""}`.trim());
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI Gateway returned no content (the model may have run out of tokens while reasoning)");
      return content;
    },
  };
}
