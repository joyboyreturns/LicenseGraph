import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkBundle, checkBundleInput, compareRunsInput, compareRunsTool, evaluateLicenceOffer, evaluateOfferInput, cheapestBundle, cheapestBundleToolInput, licenceEndDates, licenceEndDatesInput, licenceFinePrint, licenceFinePrintInput, purchasePlaybook, passportDocument, negotiationPlaybook, purchaseStatus, rulesGuide, startPurchase, startPurchaseInput, verifyPassportTool, whatIfBrief, whatIfInput, type AppClient } from "./tools";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/**
 * The LicenseGraph MCP server: its tools and the buying prompt. Shared by the stdio script
 * (`scripts/mcp-server.ts`) and the HTTP endpoint (`/api/mcp`), so both offer exactly the same thing.
 */
export function createLicenseGraphServer(app: AppClient): McpServer {
  const server = new McpServer({ name: "licensegraph", version: "0.1.0" });

  server.registerTool(
    "check_licence_bundle",
    { description: "Check a proposed set of licence offers against a project's requirements with the deterministic rules engine. Returns ok, the total in cents and every violation. Never trust a bundle without calling this.", inputSchema: checkBundleInput.shape },
    async (input) => text(checkBundle(input)),
  );

  server.registerTool(
    "evaluate_licence_offer",
    { description: "Check one licence offer against every rule for a project, the same grid the run page shows: for each rule pass, fail or skip (the rule does not apply to this brief), with the reason for each failure. Use it to tell the person exactly why an offer was set aside, or what to ask its licensor to change.", inputSchema: evaluateOfferInput.shape },
    async (input) => text(evaluateLicenceOffer(input)),
  );

  server.registerTool(
    "cheapest_compliant_bundle",
    { description: "From a set of licence offers, find the exact minimum cost of a bundle that satisfies the project, what each requirement adds to that cost, and, where an asset has no compliant offer, the nearest offer, what to ask the licensor to change, and (ifLicensorsAgree) the best-case total and per-asset price ceiling if every licensor agreed at its quoted price. Also savingLevers: where the cheapest compliant bundle could cost less if a licensor changed terms, with what to ask and the exact saving. Pass your mandate (maxSpend, maxPerLicence, avoidLicensors, and licensors to say which licensor each offer comes from) and withinMandate also gives the cheapest compliant bundle that respects it, the offers set aside and why, and what the limits cost.", inputSchema: cheapestBundleToolInput.shape },
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
    "licence_fine_print",
    { description: "The clauses in each licence that the rules engine does not check (a licence that can be ended early, a ban on training AI, limits on resale, liability, reporting duties, changes to the work), quoted word for word. Show these to the person before they approve: a bundle can pass every rule and still contain a clause they would not accept.", inputSchema: licenceFinePrintInput.shape },
    async (input) => text(licenceFinePrint(input)),
  );

  server.registerTool(
    "start_licence_purchase",
    { description: "Start a purchase from raw licence texts. LicenseGraph reads the licences, proposes a bundle and verifies it. Returns a claim link for the person you are buying for: only they can approve and pay (PayPal), you cannot.", inputSchema: startPurchaseInput.shape },
    async (input) => text(await startPurchase(app, input)),
  );

  server.registerTool(
    "get_purchase_status",
    { description: "Progress of a purchase you started: phase, verified bundle, who approved, PayPal capture, creator payouts, the Licence Passport link and a printable receipt link per creator once paid.", inputSchema: { runId: startPurchaseInput.shape.requiredAssetIds.element.describe("The runId returned by start_licence_purchase.") } },
    async ({ runId }) => text(await purchaseStatus(app, runId)),
  );

  server.registerTool(
    "compare_runs",
    { description: "Set two runs side by side, from their verified bundles: which asset's licence changed, what each now costs, and the difference in the total. Use it after a changed brief or a licensor's revised licence to tell the person exactly what moved. Read-only.", inputSchema: compareRunsInput },
    async (input) => text(await compareRunsTool(app, input)),
  );

  server.registerTool(
    "verify_licence_passport",
    { description: "Re-check the Licence Passport of a paid purchase: hash-chained ledger, approved bundle, every quote in the licence text, the rules engine on the exact terms, the PayPal capture and creator payouts, and the server's signature. Call it before treating a licence as cleared for use; report any failed check instead of assuming.", inputSchema: { runId: startPurchaseInput.shape.requiredAssetIds.element.describe("The runId of a paid purchase.") } },
    async ({ runId }) => text(await verifyPassportTool(app, runId)),
  );

  server.registerResource(
    "rules",
    "licensegraph://rules",
    { title: "The rules every licence is checked against", description: "Each rule, when it applies, and what a licence that says nothing about it gets. Read it before arguing with a verdict or drafting a request to a licensor.", mimeType: "text/markdown" },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: rulesGuide() }] }),
  );

  server.registerResource(
    "passport",
    new ResourceTemplate("licensegraph://passport/{runId}", { list: undefined }),
    { title: "A Licence Passport", description: "The signed Licence Passport of a paid purchase, as JSON. Keep it, and re-check it offline with the server's public key (/.well-known/licensegraph-keys.json).", mimeType: "application/json" },
    async (uri, { runId }) => {
      const doc = await passportDocument(app, String(runId));
      if (!doc.ok) throw new Error(doc.error);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: doc.json }] };
    },
  );

  server.registerPrompt(
    "buy_licences",
    { title: "Buy licences for a project", description: "The order to work in when buying creative licences for a person: check, price, negotiate, hand over.", argsSchema: { brief: z.string().max(2000).optional().describe("What the project needs, in plain words.") } },
    ({ brief }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: purchasePlaybook(brief) } }] }),
  );

  server.registerPrompt(
    "negotiate_licences",
    { title: "Negotiate when nothing can be bought", description: "The order to work in when no licence meets the brief: read what blocks each asset, write to each licensor, check a reply as a new run, and tell the person what moved.", argsSchema: { brief: z.string().max(2000).optional().describe("What the project needs, in plain words.") } },
    ({ brief }) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: negotiationPlaybook(brief) } }] }),
  );

  return server;
}
