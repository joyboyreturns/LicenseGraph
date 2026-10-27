import { describe, expect, it, vi } from "vitest";
import { createLlmProxy, DEFAULT_LIMITS, limitsFromEnv, ProxyError } from "../src/server/llm-proxy";

const models = (pricing: unknown) => new Response(JSON.stringify({ data: [{ id: "free/model", pricing }] }));
const chat = () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }], usage: { total_tokens: 5 }, model: "free/model" }));
const FREE = { input: "0", output: "0" };

const NO_PACING = { ...DEFAULT_LIMITS, minIntervalMs: 0 };

const make = (pricing: unknown = FREE, limits = NO_PACING, now?: () => number, sleep?: (ms: number) => Promise<void>) => {
  const fetchMock = vi.fn(async (url: string) => (url.endsWith("/v1/models") ? models(pricing) : chat()));
  const proxy = createLlmProxy({ apiKey: "secret-key", model: "free/model", fetch: fetchMock as unknown as typeof fetch }, limits, now, sleep ?? (async () => {}));
  return { proxy, fetchMock };
};
const body = { messages: [{ role: "user", content: "hi" }] };
const status = async (p: Promise<unknown>) => (await p.catch((e) => e)) as ProxyError;

describe("createLlmProxy", () => {
  it("forwards to the gateway with the server's model and key, and returns only the message", async () => {
    const { proxy, fetchMock } = make();
    const reply = await proxy({ ...body, model: "expensive/model", tools: [{ type: "function" }], tool_choice: "auto" });

    expect(reply).toEqual({ message: { content: "hi" }, usage: { total_tokens: 5 }, model: "free/model" });
    const [, init] = fetchMock.mock.calls.at(-1)! as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(JSON.parse(init.body).model).toBe("free/model"); // the browser's choice is ignored
    expect(init.headers.Authorization).toBe("Bearer secret-key");
    expect(JSON.stringify(reply)).not.toContain("secret-key");
  });

  it("checks the model is free once, then reuses the result", async () => {
    const { proxy, fetchMock } = make();
    await proxy(body);
    await proxy(body);
    expect(fetchMock.mock.calls.filter((c) => c[0].endsWith("/v1/models"))).toHaveLength(1);
  });

  it("refuses a paid model with 403 and never sends a completion", async () => {
    const { proxy, fetchMock } = make({ input: "0.000003", output: "0.000015" });
    const err = await status(proxy(body));
    expect(err).toBeInstanceOf(ProxyError);
    expect(err.status).toBe(403);
    expect(fetchMock.mock.calls.some((c) => c[0].endsWith("/chat/completions"))).toBe(false);
  });

  it("validates the request", async () => {
    const { proxy } = make();
    expect((await status(proxy(null))).status).toBe(400);
    expect((await status(proxy({ messages: [] }))).status).toBe(400);
    expect((await status(proxy({ messages: new Array(81).fill({ role: "user", content: "x" }) }))).status).toBe(413);
    expect((await status(proxy({ ...body, tools: new Array(41).fill({}) }))).status).toBe(413);
    expect((await status(proxy({ messages: [{ role: "user", content: "x".repeat(200_001) }] }))).status).toBe(413);
  });

  it("rate limits across the whole server and recovers after the window", async () => {
    let t = 0;
    const { proxy } = make(FREE, { ...NO_PACING, maxPerWindow: 2 }, () => t);
    await proxy(body);
    await proxy(body);
    expect((await status(proxy(body))).status).toBe(429);
    t = 60_001;
    await expect(proxy(body)).resolves.toBeDefined();
  });

  it("spaces calls to the model so a 5-per-minute provider limit is respected", async () => {
    let t = 1_000;
    const waits: number[] = [];
    const { proxy } = make(FREE, DEFAULT_LIMITS, () => t, async (ms) => void waits.push(ms));
    await proxy(body);
    await proxy(body);
    await proxy(body);
    expect(waits).toEqual([12_500, 25_000]); // the first call goes straight through
    t += 100_000;
    await proxy(body);
    expect(waits).toEqual([12_500, 25_000]); // idle time resets the queue
  });

  it("refuses when too many calls are already waiting", async () => {
    const release: (() => void)[] = [];
    const { proxy } = make(FREE, { ...DEFAULT_LIMITS, maxQueued: 2 }, () => 0, () => new Promise<void>((r) => release.push(r)));
    const pending = [proxy(body), proxy(body), proxy(body)]; // 1st free, 2nd and 3rd wait
    await new Promise((r) => setTimeout(r, 10));
    expect((await status(proxy(body))).status).toBe(429);
    release.forEach((r) => r());
    await Promise.all(pending);
  });
});

describe("limitsFromEnv", () => {
  it("derives the spacing from the model's requests per minute", () => {
    expect(limitsFromEnv({}).minIntervalMs).toBe(12_500);
    expect(limitsFromEnv({ LICENSEGRAPH_MODEL_RPM: "10" }).minIntervalMs).toBe(6_500);
    expect(limitsFromEnv({ LICENSEGRAPH_MODEL_RPM: "nonsense" }).minIntervalMs).toBe(12_500);
  });
});
