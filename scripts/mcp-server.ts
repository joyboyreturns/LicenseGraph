/**
 * LicenseGraph as an MCP server: lets an AI agent check licence bundles, find the cheapest compliant
 * one, explore what a change of scope would cost, and start a purchase that only a person can approve.
 *
 *   LICENSEGRAPH_URL=http://localhost:3000 npx tsx scripts/mcp-server.ts
 *
 * Add it to an MCP client as a stdio server, for example:
 *   { "command": "npx", "args": ["tsx", "scripts/mcp-server.ts"], "env": { "LICENSEGRAPH_URL": "http://localhost:3000" } }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLicenseGraphServer } from "../src/mcp/server";

const server = createLicenseGraphServer({ baseUrl: process.env.LICENSEGRAPH_URL ?? "http://localhost:3000" });

await server.connect(new StdioServerTransport());
