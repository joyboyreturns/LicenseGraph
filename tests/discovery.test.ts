import { describe, expect, it } from "vitest";
import { GET as getCard } from "../app/.well-known/mcp.json/route";
import { GET as getLlms } from "../app/llms.txt/route";
import { listedTools, llmsTxt, mcpServerCard } from "../src/mcp/discovery";

describe("agent discovery", () => {
  it("lists exactly the tools the MCP server registers", async () => {
    const names = (await listedTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["check_licence_bundle", "cheapest_compliant_bundle", "what_if_brief", "licence_fine_print", "start_licence_purchase", "get_purchase_status", "verify_licence_passport"]));
    expect((await listedTools()).every((t) => t.description.length > 20)).toBe(true);
  });

  it("points the card and llms.txt at the server that answered, and tells an agent it cannot approve or pay", async () => {
    const tools = await listedTools();
    const card = mcpServerCard("https://lg.example", tools);
    expect(card.transport.url).toBe("https://lg.example/api/mcp");
    expect(card.tools).toHaveLength(tools.length);
    const text = llmsTxt("https://lg.example", tools);
    expect(text).toContain("https://lg.example/api/mcp");
    for (const t of tools) expect(text).toContain(`- ${t.name}:`);
    expect(text).toMatch(/cannot approve or pay/);
  });

  it("serves both over HTTP", async () => {
    const card = await (await getCard()).json();
    expect(card.name).toBe("licensegraph");
    const res = await getLlms();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toMatch(/^# LicenseGraph/);
  });
});
