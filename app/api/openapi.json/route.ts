import { buildOpenApi } from "@/src/api/openapi";
import { json } from "@/src/server/http";
import { getRuntime } from "@/src/server/runtime";

export const dynamic = "force-dynamic";

/** The machine-readable description of this API, pointing at the server that answered. */
export function GET() {
  return json(buildOpenApi(getRuntime().appUrl));
}
