import { describe, expect, it, vi } from "vitest";
import { assertModelIsFree, createGatewayModel } from "../src/extraction/model";
import { createLlmProxy, DEFAULT_LIMITS } from "../src/server/llm-proxy";

const ask = { system: "s", user: "u" };
const conversation = { messages: [{ role: "user", content: "u" }] };
const free = { input: "0", output: "0" };
const listing = (pricing: unknown) => new Response(JSON.stringify({ data: [{ id: "test", pricing }] }));
const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));

describe("gateway credit safety", () => {
  it.each(["extraction", "assistant"])("refuses a price increase on the next %s request", async (kind) => {
    let pricing: unknown = free;
    const transport = vi.fn(async (url: string) => url.endsWith("/models") ? listing(pricing) : reply());
    const config = { apiKey: "fixture", model: "test", fetch: transport as typeof fetch };
    const complete = kind === "extraction"
      ? () => create.complete(ask)
      : () => proxy(conversation);
    const create = createGatewayModel(config);
    const proxy = createLlmProxy(config, { ...DEFAULT_LIMITS, minIntervalMs: 0 });
    await complete();
    pricing = { input: "0", output: "0.01" };
    await expect(complete()).rejects.toThrow(/not free/);
    expect(transport.mock.calls.filter(([url]) => url.endsWith("/completions"))).toHaveLength(1);
  });

  it.each([false, true, [], {}, " ", "0x0", null, undefined])("refuses malformed zero prices: %j", async (price) => {
    const transport = vi.fn(async () => listing({ input: price, output: "0" }));
    await expect(assertModelIsFree({ apiKey: "fixture", model: "test", fetch: transport as typeof fetch })).rejects.toThrow(/not free/);
  });

  it("checks prices after waiting in the queue", async () => {
    let pricing: unknown = free;
    let clock = 1;
    const transport = vi.fn(async (url: string) => url.endsWith("/models") ? listing(pricing) : reply());
    const model = createGatewayModel({ apiKey: "fixture", model: "test", fetch: transport as typeof fetch,
      minIntervalMs: 100, now: () => clock, sleep: async (ms) => { clock += ms; pricing = { input: "1", output: "1" }; } });
    await model.complete(ask);
    await expect(model.complete(ask)).rejects.toThrow(/not free/);
    expect(transport.mock.calls.filter(([url]) => url.endsWith("/completions"))).toHaveLength(1);
  });

  it("bounds a stalled completion body even when the transport ignores abort", async () => {
    const transport = vi.fn(async (url: string) => url.endsWith("/models") ? listing(free) : new Response(new ReadableStream()));
    const model = createGatewayModel({ apiKey: "fixture", model: "test", timeoutMs: 15, fetch: transport as typeof fetch });
    await expect(model.complete(ask)).rejects.toThrow(/timed out after 15ms/);
  });

  it("bounds a stalled price-list body without sending a completion", async () => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn(async () => new Response(new ReadableStream()));
      const promise = expect(assertModelIsFree({ apiKey: "fixture", model: "test", fetch: transport as typeof fetch })).rejects.toThrow(/price check timed out/);
      await vi.advanceTimersByTimeAsync(15_000);
      await promise;
      expect(transport).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
