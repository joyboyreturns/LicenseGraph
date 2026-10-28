import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createLicenseGraphServer } from "@/src/mcp/server";

export const dynamic = "force-dynamic";

/**
 * The MCP server over HTTP (Streamable HTTP, stateless), so an agent can connect to a running LicenseGraph
 * without cloning anything: point an MCP client at `<this server>/api/mcp`. Same tools as `scripts/mcp-server.ts`.
 * The agent can check, price and start a purchase; only a person with the claim link can approve and pay.
 */
export async function POST(req: Request) {
  const server = createLicenseGraphServer({ baseUrl: new URL(req.url).origin });
  // Stateless: nothing is kept between requests, so any instance can answer any call.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void transport.close().catch(() => undefined);
  }
}
