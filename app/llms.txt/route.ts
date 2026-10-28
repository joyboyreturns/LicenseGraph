import { listedTools, llmsTxt } from "@/src/mcp/discovery";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** A plain-text introduction for AI agents and the crawlers that feed them. */
export async function GET() {
  return new Response(llmsTxt(getRuntime().appUrl, await listedTools()), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
