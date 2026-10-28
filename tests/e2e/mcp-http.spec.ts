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

test("an agent can re-check a Licence Passport over MCP before relying on a licence, and is told when there is none yet", async ({ baseURL, request }) => {
  const { id } = await (await request.post("/api/sessions", { data: { scenarioId: "podcast" } })).json();
  await expect.poll(async () => (await (await request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");

  const client = new Client({ name: "e2e-agent", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL)));
  const verify = async (runId: string) => JSON.parse(((await client.callTool({ name: "verify_licence_passport", arguments: { runId } })).content as { text: string }[])[0]!.text);
  try {
    // Verified but not paid: there is no passport to check, and the tool says so instead of inventing a result.
    expect(await verify(id)).toMatchObject({ ok: false, error: expect.stringMatching(/paid|captured|payment/i) });

    await request.post(`/api/sessions/${id}/approve`, { data: { approvedBy: "Kiran" } });
    const paid = await (await request.post(`/api/sessions/${id}/pay`)).json();
    await request.post(`/api/simulator/orders/${paid.order.id}`);
    await request.post(`/api/sessions/${id}/capture`);

    const result = await verify(id);
    expect(result).toMatchObject({ ok: true, verified: true, failedChecks: [] });
    expect(result.checks).toHaveLength(9);
    expect(result.passportUrl).toContain(`/passport/${id}`);

    // The status tool hands the agent one receipt link per creator, to pass on to the person.
    const status = JSON.parse(((await client.callTool({ name: "get_purchase_status", arguments: { runId: id } })).content as { text: string }[])[0]!.text);
    expect(status.creatorReceipts.map((r: { assetId: string }) => r.assetId).sort()).toEqual(["image", "song", "voiceover"]);
    expect(status.creatorReceipts[0].url).toMatch(new RegExp(`/passport/${id}/receipt/[a-z]+$`));
  } finally {
    await client.close();
  }
});
