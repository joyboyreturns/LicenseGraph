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
}

export function gatewayConfigFromEnv(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const { AI_GATEWAY_API_KEY: apiKey, LICENSEGRAPH_MODEL: model } = env;
  if (!apiKey || !model) throw new Error("AI_GATEWAY_API_KEY and LICENSEGRAPH_MODEL must be set");
  return { apiKey, model };
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
  let checked: Promise<void> | undefined;
  return {
    async complete({ system, user }) {
      checked ??= assertModelIsFree(config);
      await checked;
      const res = await doFetch(`${config.baseUrl ?? "https://ai-gateway.vercel.sh"}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          // Generous: reasoning models spend tokens thinking before they answer.
          max_tokens: config.maxTokens ?? 8000,
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
