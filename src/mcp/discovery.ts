import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLicenseGraphServer } from "./server";
import { purchasePlaybook, rulesGuide } from "./tools";

export interface ToolSummary {
  name: string;
  description: string;
}

let listed: Promise<ToolSummary[]> | undefined;

/** The tools the MCP endpoint really offers, read from the server itself so a discovery file can never drift from it. */
export function listedTools(): Promise<ToolSummary[]> {
  listed ??= (async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "discovery", version: "1" });
    const server = createLicenseGraphServer({ baseUrl: "http://discovery.invalid" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    try {
      return (await client.listTools()).tools.map((t) => ({ name: t.name, description: t.description ?? "" }));
    } finally {
      await client.close();
    }
  })().catch((e) => {
    listed = undefined;
    throw e;
  });
  return listed;
}

/** A small machine-readable card at /.well-known/mcp.json: where the endpoint is and what it can do. */
export function mcpServerCard(appUrl: string, tools: ToolSummary[]) {
  return {
    name: "licensegraph",
    description: "Check creative licences against a project brief, find the exact cheapest compliant bundle, and start a purchase that only a person can approve and pay.",
    transport: { type: "streamable-http", url: `${appUrl}/api/mcp`, stateless: true },
    authentication: "none",
    tools,
    prompts: ["buy_licences"],
    resources: ["licensegraph://rules"],
    humanInTheLoop: "An agent can start a purchase and receives a claim link. Only the person who opens it can approve, and PayPal moves the money.",
    docs: { passportKeys: `${appUrl}/.well-known/licensegraph-keys.json`, openapi: `${appUrl}/api/openapi.json`, agents: `${appUrl}/agents`, rules: `${appUrl}/rules` },
  };
}

/** The llms.txt convention: a plain-text page an agent can read first to learn what this site does and how to use it. */
export function llmsTxt(appUrl: string, tools: ToolSummary[]): string {
  return [
    "# LicenseGraph",
    "",
    "> An AI agent reads creative licences and proposes a bundle; a deterministic rules engine verifies it against the project's brief; a person approves; PayPal pays the creators. Every purchase ends in a Licence Passport anyone can re-check.",
    "",
    "The model proposes, the code verifies, a person approves. A bundle that fails any rule cannot be approved or paid, and an agent cannot approve or pay at all.",
    "",
    "## Connect an agent",
    "",
    `- MCP endpoint (Streamable HTTP, no sign-in): ${appUrl}/api/mcp`,
    `- Server card: ${appUrl}/.well-known/mcp.json`,
    `- This page with the rules and the buying playbook included: ${appUrl}/llms-full.txt`,
    `- REST API (OpenAPI 3.1): ${appUrl}/api/openapi.json`,
    `- Watch an agent work, and connect your own: ${appUrl}/agents`,
    `- Public key that checks Licence Passport signatures offline (Ed25519): ${appUrl}/.well-known/licensegraph-keys.json`,
    "",
    "## Tools",
    "",
    ...tools.map((t) => `- ${t.name}: ${t.description}`),
    "",
    "## Working order",
    "",
    "Prompt `buy_licences` gives the order: check, price, negotiate, hand over. Resource `licensegraph://rules` lists every rule and what a licence's silence means. Read the fine print with licence_fine_print before handing a bundle to the person, and re-check a paid purchase with verify_licence_passport before relying on it.",
    "",
    "## Pages",
    "",
    `- ${appUrl}/tour: seven things to try, in order, with what to look for in each`,
    `- ${appUrl}/rules: every rule the engine checks, and what silence in a licence means`,
    `- ${appUrl}/verify: re-check a Licence Passport in the browser`,
    "",
  ].join("\n");
}

/** llms.txt plus everything an agent would otherwise fetch next: the rules and the working order, in one page. */
export function llmsFullTxt(appUrl: string, tools: ToolSummary[]): string {
  return [llmsTxt(appUrl, tools).trimEnd(), "", "---", "", rulesGuide(), "", "---", "", "# The buying playbook", "", purchasePlaybook(), ""].join("\n");
}
