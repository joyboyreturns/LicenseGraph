/**
 * LicenseGraph as an MCP server: lets an AI agent check licence bundles, find the cheapest compliant
 * one, explore what a change of scope would cost, and start a purchase that only a person can approve.
 *
 *   LICENSEGRAPH_URL=http://localhost:3000 npx tsx scripts/mcp-server.ts
 *
 * Add it to an MCP client as a stdio server, for example:
 *   { "command": "npx", "args": ["tsx", "scripts/mcp-server.ts"], "env": { "LICENSEGRAPH_URL": "http://localhost:3000" } }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { checkBundle, checkBundleInput, cheapestBundle, cheapestBundleInput, licenceEndDates, licenceEndDatesInput, purchaseStatus, startPurchase, startPurchaseInput, whatIfBrief, whatIfInput } from "../src/mcp/tools";

const app = { baseUrl: process.env.LICENSEGRAPH_URL ?? "http://localhost:3000" };
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

const server = new McpServer({ name: "licensegraph", version: "0.1.0" });

server.registerTool(
  "check_licence_bundle",
  { description: "Check a proposed set of licence offers against a project's requirements with the deterministic rules engine. Returns ok, the total in cents and every violation. Never trust a bundle without calling this.", inputSchema: checkBundleInput.shape },
  async (input) => text(checkBundle(input)),
);

server.registerTool(
  "cheapest_compliant_bundle",
  { description: "From a set of licence offers, find the exact minimum cost of a bundle that satisfies the project, what each requirement adds to that cost, and, where an asset has no compliant offer, the nearest offer, what to ask the licensor to change, and (ifLicensorsAgree) the best-case total and per-asset price ceiling if every licensor agreed at its quoted price.", inputSchema: cheapestBundleInput.shape },
  async (input) => text(cheapestBundle(input)),
);

server.registerTool(
  "what_if_brief",
  { description: "Ask what the purchase would cost if the brief changed: a different territory, term, media, or a requirement dropped or added. Returns the exact cheapest compliant total for the changed brief, the difference from the brief as written, which asset's licence would change, and for any asset nothing covers, what to ask the licensor to change. Use it to negotiate scope with exact figures before buying.", inputSchema: whatIfInput.shape },
  async (input) => text(whatIfBrief(input)),
);

server.registerTool(
  "licence_end_dates",
  { description: "When each licence stops covering the project, counted from the day of purchase, soonest first (a perpetual licence has no end). Also returns an iCalendar file with a reminder 30 days before each end, so licences are renewed before the project is exposed.", inputSchema: licenceEndDatesInput.shape },
  async (input) => text(licenceEndDates(input)),
);

server.registerTool(
  "start_licence_purchase",
  { description: "Start a purchase from raw licence texts. LicenseGraph reads the licences, proposes a bundle and verifies it. Returns a claim link for the person you are buying for: only they can approve and pay (PayPal), you cannot.", inputSchema: startPurchaseInput.shape },
  async (input) => text(await startPurchase(app, input)),
);

server.registerTool(
  "get_purchase_status",
  { description: "Progress of a purchase you started: phase, verified bundle, who approved, PayPal capture, creator payouts and the Licence Passport link once paid.", inputSchema: { runId: startPurchaseInput.shape.requiredAssetIds.element.describe("The runId returned by start_licence_purchase.") } },
  async ({ runId }) => text(await purchaseStatus(app, runId)),
);

await server.connect(new StdioServerTransport());
