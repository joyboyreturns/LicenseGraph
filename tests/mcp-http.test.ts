import { describe, expect, it } from "vitest";
import { POST } from "../app/api/mcp/route";
import { runExample } from "./mcp-fixtures";

const example = await runExample();

let nextId = 1;
/** One JSON-RPC call to the endpoint, the way an MCP client makes it. */
async function rpc(method: string, params?: unknown) {
  const res = await POST(
    new Request("http://app/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  return { status: res.status, body: (await res.json()) as any };
}

describe("MCP over HTTP", () => {
  it("initializes and says what it is", async () => {
    const { status, body } = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("licensegraph");
    expect(body.result.capabilities).toHaveProperty("tools");
    expect(body.result.capabilities).toHaveProperty("prompts");
  });

  it("lists the same tools as the stdio server, and the buying prompt", async () => {
    const tools = (await rpc("tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(["check_licence_bundle", "cheapest_compliant_bundle", "what_if_brief", "licence_end_dates", "licence_fine_print", "start_licence_purchase", "get_purchase_status", "verify_licence_passport"]);
    const prompts = (await rpc("prompts/list")).body.result.prompts.map((p: { name: string }) => p.name);
    expect(prompts).toEqual(["buy_licences"]);
  });

  it("runs a tool and returns the exact answer the rules engine gives", async () => {
    const { body } = await rpc("tools/call", { name: "cheapest_compliant_bundle", arguments: example });
    const result = JSON.parse(body.result.content[0].text);
    expect(result.plans[0]).toMatchObject({ currency: "USD", totalCents: 32_900 });
  });

  it("gives the prompt with the brief filled in", async () => {
    const { body } = await rpc("prompts/get", { name: "buy_licences", arguments: { brief: "A trailer, worldwide" } });
    expect(body.result.messages[0].content.text).toContain("A trailer, worldwide");
  });

  it("answers a request that is not MCP with an error, not a crash", async () => {
    const res = await POST(new Request("http://app/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{nope" }));
    expect(res.status).toBe(400);
  });
});
