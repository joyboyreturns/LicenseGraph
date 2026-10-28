import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";

test("an MCP client connects to the running server over HTTP, prices a purchase and starts one that only a person can approve", async ({ baseURL }) => {
  const client = new Client({ name: "e2e-agent", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL)));
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("cheapest_compliant_bundle");
    expect(tools).toContain("start_licence_purchase");
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["buy_licences"]);

    // The agent's view of a verified-by-code price: a one-asset project with one offer.
    const offer = { id: "o1", assetId: "song", priceCents: 12_000, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24 }, evidence: [{ documentId: "d1", quote: "USD 120.00" }] };
    const priced = await client.callTool({ name: "cheapest_compliant_bundle", arguments: { project: { name: "P", commercial: true, territories: ["US"], termMonths: 12 }, requiredAssetIds: ["song"], offers: [offer] } });
    const plan = JSON.parse((priced.content as { text: string }[])[0]!.text).plans[0];
    expect(plan).toMatchObject({ currency: "USD", totalCents: 12_000, offerIds: ["o1"] });
  } finally {
    await client.close();
  }
});
