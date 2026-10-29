import { assertModelIsFree, type GatewayConfig } from "../extraction/model";

export interface ProxyLimits {
  maxMessages: number;
  maxBodyChars: number;
  maxTools: number;
  /** Requests allowed per window across the whole server. */
  maxPerWindow: number;
  windowMs: number;
  /** Minimum gap between calls to the model, to stay inside the provider's own rate limit. */
  minIntervalMs: number;
  /** Calls allowed to wait for their turn; beyond this the request is refused. */
  maxQueued: number;
}

/** Free models are typically limited to about 5 requests a minute, so calls are spaced 12.5 s apart. */
export const DEFAULT_LIMITS: ProxyLimits = { maxMessages: 80, maxBodyChars: 200_000, maxTools: 40, maxPerWindow: 20, windowMs: 60_000, minIntervalMs: 12_500, maxQueued: 4 };

/** Build limits from the model's requests-per-minute allowance (LICENSEGRAPH_MODEL_RPM, default 5). */
export function limitsFromEnv(env: Record<string, string | undefined> = process.env): ProxyLimits {
  const rpm = Number(env.LICENSEGRAPH_MODEL_RPM);
  return rpm > 0 ? { ...DEFAULT_LIMITS, minIntervalMs: Math.ceil(60_000 / rpm) + 500 } : DEFAULT_LIMITS;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Lets the dashboard's assistant call the model without ever holding the gateway key. The model is
 * fixed by the server, never taken from the request, and is checked free before every first use,
 * so the browser cannot choose a paid model or spend credits.
 */
export function createLlmProxy(config: GatewayConfig, limits: ProxyLimits = DEFAULT_LIMITS, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = realSleep) {
  const doFetch = config.fetch ?? fetch;
  let checked: Promise<void> | undefined;
  let recent: number[] = [];
  let nextSlot = 0;
  let waiting = 0;

  return async function proxy(body: unknown) {
    const b = body as { messages?: unknown; tools?: unknown; tool_choice?: unknown } | null;
    if (!b || !Array.isArray(b.messages) || b.messages.length === 0) throw new ProxyError("Send a non-empty messages array.", 400);
    if (b.messages.length > limits.maxMessages) throw new ProxyError("Conversation is too long.", 413);
    if (b.tools !== undefined && (!Array.isArray(b.tools) || b.tools.length > limits.maxTools)) throw new ProxyError("Too many tools.", 413);
    if (JSON.stringify(b).length > limits.maxBodyChars) throw new ProxyError("Request is too large.", 413);

    const t = now();
    recent = recent.filter((x) => t - x < limits.windowMs);
    if (recent.length >= limits.maxPerWindow) throw new ProxyError("Too many assistant requests. Try again in a minute.", 429);
    recent.push(t);

    checked ??= assertModelIsFree(config).catch((e) => {
      checked = undefined; // a failed check is retried, never cached as a pass
      throw e;
    });
    try {
      await checked;
    } catch (e) {
      throw new ProxyError(e instanceof Error ? e.message : "Model check failed.", 403);
    }

    // Take the next free slot: calls queue up rather than fail when the provider only allows a few a minute.
    if (waiting >= limits.maxQueued) throw new ProxyError("The assistant is busy. Try again in a moment.", 429);
    const slot = Math.max(now(), nextSlot);
    nextSlot = slot + limits.minIntervalMs;
    const wait = slot - now();
    if (wait > 0) {
      waiting++;
      try {
        await sleep(wait);
      } finally {
        waiting--;
      }
    }

    const timeoutMs = config.timeoutMs ?? 100_000;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await doFetch(`${config.baseUrl ?? "https://ai-gateway.vercel.sh"}/v1/chat/completions`, {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model, // fixed by the server
          temperature: 0,
          max_tokens: config.maxTokens ?? 16000,
          messages: b.messages,
          ...(b.tools ? { tools: b.tools } : {}),
          ...(b.tools && b.tool_choice ? { tool_choice: b.tool_choice } : {}),
        }),
      });
      const json = (await res.json().catch((e) => {
        if (signal.aborted) throw e;
        return {};
      })) as { choices?: { message?: unknown }[]; usage?: unknown; model?: string; error?: { message?: string } };
      if (!res.ok) throw new ProxyError(`The model request failed (${res.status}). ${json.error?.message ?? ""}`.trim(), 502);
      return { message: json.choices?.[0]?.message, usage: json.usage, model: json.model };
    } catch (e) {
      if (signal.aborted) {
        const duration = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;
        throw new ProxyError(`The assistant model request timed out after ${duration}. Try again when the service is available.`, 504);
      }
      throw e;
    }
  };
}
