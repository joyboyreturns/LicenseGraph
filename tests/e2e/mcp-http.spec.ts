import { verifyWithPublicKey } from "../../src/server/passport-signing";
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

test("an agent can find the MCP endpoint without being told: llms.txt, the server card, robots and the sitemap", async ({ request, baseURL }) => {
  const llms = await request.get("/llms.txt");
  expect(llms.status()).toBe(200);
  expect(llms.headers()["content-type"]).toContain("text/plain");
  const text = await llms.text();
  expect(text).toContain(`${new URL("/api/mcp", baseURL).href}`);
  expect(text).toContain("- verify_licence_passport:");

  const card = await (await request.get("/.well-known/mcp.json")).json();
  expect(card.transport).toMatchObject({ type: "streamable-http", url: new URL("/api/mcp", baseURL).href });
  // The card lists what the live endpoint really offers.
  const client = new Client({ name: "e2e-agent", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(card.transport.url)));
  try {
    expect(card.tools.map((t: { name: string }) => t.name)).toEqual((await client.listTools()).tools.map((t) => t.name));
  } finally {
    await client.close();
  }

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /run/");
  expect(robots).toContain("Sitemap:");
  expect(await (await request.get("/sitemap.xml")).text()).toContain("/agents");
});

test("a paid passport can be checked against the server's published public key, offline, and a changed one fails", async ({ request }) => {
  const { id } = await (await request.post("/api/sessions", { data: { scenarioId: "podcast" } })).json();
  await expect.poll(async () => (await (await request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  await request.post(`/api/sessions/${id}/approve`, { data: { approvedBy: "Kiran" } });
  const paid = await (await request.post(`/api/sessions/${id}/pay`)).json();
  await request.post(`/api/simulator/orders/${paid.order.id}`);
  await request.post(`/api/sessions/${id}/capture`);

  const passport = await (await request.get(`/api/passports/${id}`)).json();
  const { keys } = await (await request.get("/.well-known/licensegraph-keys.json")).json();
  expect(passport.signature).toMatchObject({ algorithm: "Ed25519", keyId: keys[0].keyId });
  // No secret and no server call: the public key alone.
  expect(verifyWithPublicKey(passport, keys[0].publicKey)).toBe("valid");
  passport.paypal.captureId = "FORGED";
  expect(verifyWithPublicKey(passport, keys[0].publicKey)).toBe("invalid");
});
