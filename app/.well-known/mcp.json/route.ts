import { listedTools, mcpServerCard } from "@/src/mcp/discovery";
import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** Where an agent finds this site's MCP endpoint and what it offers, without being told. */
export async function GET() {
  return json(mcpServerCard(getRuntime().appUrl, await listedTools()));
}
