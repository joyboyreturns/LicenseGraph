import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** What the server-side proxy returns: the model's message, nothing else. */
export interface ProxyReply {
  message: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
}

const textOf = (content: { type: string; text?: string }[]) => content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");

/** Convert Studio's conversation into chat-completions messages. Adjacent tool calls share one assistant message. */
export function toChatMessages(request: Pick<AgLlmRequest, "input" | "instructions" | "responseFormat">): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let system = request.instructions ?? "";
  if (request.responseFormat.type === "json") {
    system += `\n\nReply with only a JSON object matching this schema: ${JSON.stringify(request.responseFormat.schema)}`;
  }
  if (system) messages.push({ role: "system", content: system });

  for (const item of request.input as AgAiConversationItem[]) {
    if (item.type === "message" && item.kind === "input") {
      messages.push({ role: item.role, content: textOf(item.content) });
    } else if (item.type === "message") {
      messages.push({ role: "assistant", content: textOf(item.content as { type: string; text?: string }[]) });
    } else if (item.type === "function_call") {
      const call = { id: item.callId, type: "function" as const, function: { name: item.name, arguments: item.arguments } };
      const last = messages.at(-1);
      if (last?.role === "assistant" && last.tool_calls) last.tool_calls.push(call);
      else messages.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (item.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: item.callId, content: item.output });
    }
    // Reasoning items are not sent back to the model.
  }
  return messages;
}

export function toChatTools(request: Pick<AgLlmRequest, "tools">) {
  const tools = (request.tools ?? []).filter((t) => t.kind !== "provided");
  return tools.length ? tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined;
}

export function toToolChoice(choice: AgLlmRequest["toolChoice"]) {
  if (!choice) return undefined;
  return typeof choice === "string" ? choice : { type: "function" as const, function: { name: choice.name } };
}

export interface AdapterConfig {
  /** The proxy route, which holds the gateway key and decides the model. */
  endpoint: string;
  fetch?: typeof fetch;
}

/**
 * Connects AG Studio's assistant to a chat-completions endpoint. It takes the model's whole reply
 * and replays it to Studio as stream events, which is simpler and sturdier than parsing a live
 * stream from a small free model.
 */
export function chatCompletionsAdapter(config: AdapterConfig): AgLlmAdapter {
  const doFetch = config.fetch ?? fetch;
  return {
    executeTurn(request, options) {
      const id = crypto.randomUUID();
      const createdAt = Date.now();

      const turn = (async (): Promise<{ events: AgAiEvent[]; response: AgLlmResponse }> => {
        const fail = (code: string, message: string, status: AgLlmResponse["status"] = "failed") => ({
          events: [] as AgAiEvent[],
          response: { id, createdAt, status, output: [], error: { code, message } } satisfies AgLlmResponse,
        });
        try {
          const res = await doFetch(config.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: toChatMessages(request), tools: toChatTools(request), tool_choice: toToolChoice(request.toolChoice) }),
            signal: options?.signal,
          });
          const body = (await res.json().catch(() => ({}))) as Partial<ProxyReply> & { error?: string };
          if (!res.ok) return fail("http_error", body.error ?? `Request failed (${res.status})`);
          const message = body.message;
          if (!message) return fail("no_message", "The model returned no message.");

          const events: AgAiEvent[] = [];
          const output: AgAiOutputItem[] = [];
          const text = (message.content ?? "").trim();
          if (text) {
            events.push({ type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" }, { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: text }, { type: "TEXT_MESSAGE_END", messageId: id });
            output.push({ id, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
          }
          for (const [i, call] of (message.tool_calls ?? []).entries()) {
            const callId = call.id ?? `${id}-call-${i}`;
            const name = call.function?.name ?? "";
            const args = call.function?.arguments ?? "{}";
            events.push({ type: "TOOL_CALL_START", toolCallId: callId, toolCallName: name }, { type: "TOOL_CALL_ARGS", toolCallId: callId, delta: args }, { type: "TOOL_CALL_END", toolCallId: callId });
            output.push({ id: callId, kind: "output", type: "function_call", callId, name, arguments: args, status: "completed" });
          }
          if (output.length === 0) return fail("empty_reply", "The model returned an empty reply (it may have run out of tokens while thinking). Try again.", "incomplete");

          const u = body.usage;
          return {
            events,
            response: {
              id,
              createdAt,
              status: "completed",
              output,
              model: body.model,
              usage: u ? ({ inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0, totalTokens: u.total_tokens ?? 0 } as AgLlmResponse["usage"]) : undefined,
            },
          };
        } catch (e) {
          return options?.signal?.aborted ? fail("cancelled", "Cancelled", "cancelled") : fail("network_error", e instanceof Error ? e.message : String(e));
        }
      })();

      return {
        stream: {
          async *[Symbol.asyncIterator]() {
            for (const event of (await turn).events) yield event;
          },
        },
        complete: turn.then((t) => t.response),
      };
    },
  };
}
