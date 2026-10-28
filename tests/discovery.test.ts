import { describe, expect, it } from "vitest";
import { GET as getCard } from "../app/.well-known/mcp.json/route";
import { GET as getKeys } from "../app/.well-known/licensegraph-keys.json/route";
import { GET as getLlms } from "../app/llms.txt/route";
import { RULE_CATALOG } from "../src/core/rules";
import { listedTools, llmsTxt, mcpServerCard } from "../src/mcp/discovery";
import { rulesGuide } from "../src/mcp/tools";
import { passportKey } from "../src/server/passport-signing";

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

  it("publishes the rules as a resource that names every rule the engine has, with what silence means", () => {
    const guide = rulesGuide();
    for (const r of RULE_CATALOG) expect(guide).toContain(`## ${r.label} (\`${r.id}\`)`);
    expect(guide.match(/If the licence is silent:/g)).toHaveLength(RULE_CATALOG.length);
    expect(guide).not.toContain("See the rules page");
    expect(mcpServerCard("https://lg.example", []).resources).toEqual(["licensegraph://rules"]);
  });

  it("publishes the passport public key only when the server signs, and never the secret", async () => {
    const g = globalThis as unknown as { __licensegraph?: Record<string, unknown> };
    const before = g.__licensegraph;
    try {
      g.__licensegraph = { passportSecret: undefined, appUrl: "http://app" };
      expect((await getKeys()).status).toBe(404);
      g.__licensegraph = { passportSecret: "a very private secret", appUrl: "http://app" };
      const res = await getKeys();
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).not.toContain("a very private secret");
      expect(JSON.parse(text).keys[0]).toMatchObject({ algorithm: "Ed25519", publicKey: passportKey("a very private secret").publicKey, keyId: passportKey("a very private secret").keyId });
    } finally {
      g.__licensegraph = before;
    }
  });
});
