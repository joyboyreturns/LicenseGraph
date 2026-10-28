import { listedTools, llmsFullTxt } from "@/src/mcp/discovery";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** The introduction for AI agents with the rules and the buying playbook included, so one fetch is enough. */
export async function GET() {
  return new Response(llmsFullTxt(getRuntime().appUrl, await listedTools()), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
