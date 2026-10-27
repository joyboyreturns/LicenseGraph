import { describe, expect, it, vi } from "vitest";
import { chatCompletionsAdapter, toChatMessages, toChatTools, toToolChoice } from "../src/dashboard/llm-adapter";

const text = (t: string) => [{ type: "text" as const, text: t }];

describe("toChatMessages", () => {
  it("builds system, user and assistant messages and skips reasoning", () => {
    const messages = toChatMessages({
      instructions: "You build dashboards.",
      responseFormat: { type: "text" },
      input: [
        { id: "1", kind: "input", type: "message", role: "user", content: text("Show spend"), status: "completed" },
        { id: "2", kind: "output", type: "reasoning", summary: [] },
        { id: "3", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Sure", annotations: [] }] },
      ],
    });
    expect(messages).toEqual([
      { role: "system", content: "You build dashboards." },
      { role: "user", content: "Show spend" },
      { role: "assistant", content: "Sure" },
    ]);
  });

  it("groups adjacent tool calls into one assistant message and returns tool results", () => {
    const messages = toChatMessages({
      responseFormat: { type: "text" },
      input: [
        { id: "a", kind: "output", type: "function_call", callId: "c1", name: "view_schema", arguments: "{}" },
        { id: "b", kind: "output", type: "function_call", callId: "c2", name: "view_page", arguments: "{}" },
        { type: "function_call_output", callId: "c1", output: "tables: offers", status: "completed" },
        { type: "function_call_output", callId: "c2", output: "page: overview", status: "completed" },
      ],
    });
    expect(messages[0]).toMatchObject({ role: "assistant", content: null, tool_calls: [{ id: "c1" }, { id: "c2" }] });
    expect(messages.slice(1)).toEqual([
      { role: "tool", tool_call_id: "c1", content: "tables: offers" },
      { role: "tool", tool_call_id: "c2", content: "page: overview" },
    ]);
  });

  it("asks for JSON in the system message when a JSON format is required", () => {
    const [system] = toChatMessages({ instructions: "x", input: [], responseFormat: { type: "json", name: "n", schema: { type: "object" } as never } });
    expect(system!.content).toContain('{"type":"object"}');
  });
});

describe("tools", () => {
  it("wraps function tools and drops provider-hosted ones", () => {
    const tools = toChatTools({ tools: [{ name: "add_widget", description: "d", parameters: { type: "object" } as never }, { name: "web", description: "w", parameters: {} as never, kind: "provided" }] });
    expect(tools).toEqual([{ type: "function", function: { name: "add_widget", description: "d", parameters: { type: "object" } } }]);
    expect(toChatTools({ tools: [] })).toBeUndefined();
  });
  it("maps tool choice", () => {
    expect(toToolChoice(undefined)).toBeUndefined();
    expect(toToolChoice("auto")).toBe("auto");
    expect(toToolChoice({ name: "x" })).toEqual({ type: "function", function: { name: "x" } });
  });
});

const run = async (reply: Response | Error, signal?: AbortSignal) => {
  const fetchMock = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const adapter = chatCompletionsAdapter({ endpoint: "/api/llm", fetch: fetchMock as unknown as typeof fetch });
  const handler = adapter.executeTurn({ input: [], responseFormat: { type: "text" } }, { signal });
  const events = [];
  for await (const e of handler.stream) events.push(e);
  return { events, response: await handler.complete, fetchMock };
};
const ok = (message: unknown) => new Response(JSON.stringify({ message, model: "m", usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }));

describe("chatCompletionsAdapter", () => {
  it("turns a text reply into stream events and a completed response", async () => {
    const { events, response } = await run(ok({ content: "Hello" }));
    expect(events.map((e) => e.type)).toEqual(["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]);
    expect(response).toMatchObject({ status: "completed", model: "m", output: [{ type: "message", content: [{ text: "Hello" }] }] });
  });

  it("turns tool calls into events and function_call output items", async () => {
    const { events, response } = await run(ok({ content: null, tool_calls: [{ id: "t1", function: { name: "add_widget", arguments: '{"a":1}' } }] }));
    expect(events).toEqual([
      { type: "TOOL_CALL_START", toolCallId: "t1", toolCallName: "add_widget" },
      { type: "TOOL_CALL_ARGS", toolCallId: "t1", delta: '{"a":1}' },
      { type: "TOOL_CALL_END", toolCallId: "t1" },
    ]);
    expect(response.output[0]).toMatchObject({ type: "function_call", callId: "t1", name: "add_widget", arguments: '{"a":1}' });
  });

  it("reports an empty reply as incomplete, not as success", async () => {
    const { events, response } = await run(ok({ content: "  " }));
    expect(events).toEqual([]);
    expect(response).toMatchObject({ status: "incomplete", error: { code: "empty_reply" } });
  });

  it("reports server errors and network errors through the response", async () => {
    expect((await run(new Response(JSON.stringify({ error: "Too many assistant requests." }), { status: 429 }))).response).toMatchObject({ status: "failed", error: { message: "Too many assistant requests." } });
    expect((await run(new Error("offline"))).response).toMatchObject({ status: "failed", error: { code: "network_error", message: "offline" } });
  });

  it("marks an aborted turn as cancelled", async () => {
    const c = new AbortController();
    c.abort();
    expect((await run(new Error("aborted"), c.signal)).response.status).toBe("cancelled");
  });

  it("never sends a model or a key: only messages, tools and tool choice", async () => {
    const { fetchMock } = await run(ok({ content: "x" }));
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, { body: string }];
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(["messages"]);
  });
});
