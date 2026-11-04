import { ZodError } from "zod";
import { AccessError, requireSameOrigin } from "../auth/identity";
import { SessionError } from "../app-logic/session";
import { getRuntime } from "../server/runtime";
import { ConflictError } from "../storage/runs";
import { getPrivateRuntime, privateWorkspaceEnabled, type PrivateRuntime } from "./runtime";
import type { MarketplaceContext } from "./handlers/context";
import { json, readJson } from "./handlers/common";
import { handleAccount } from "./handlers/account";
import { handleBuyer } from "./handlers/buyer";
import { handlePublicRoutes } from "./handlers/public";
import { handleRunRoutes } from "./handlers/runs";
import { handleSeller } from "./handlers/seller";
import { handleStaff } from "./handlers/staff";
import { handleToolRoutes } from "./handlers/tools";

/**
 * Agent credentials may start and read runs and read the catalogue. Everything that approves, pays, claims or changes
 * a marketplace record needs a browser session.
 */
function agentMayCall(method: string, path: string): boolean {
  if (method === "GET") {
    return (
      /^\/api\/(?:sessions\/[^/]+|passports\/[^/]+(?:\/(?:badge|qr|verify))?)$/.test(path) ||
      path === "/api/sessions" ||
      path.startsWith("/api/marketplace/operations/") ||
      path === "/api/marketplace/catalog"
    );
  }
  return method === "POST" && ["/api/sessions", "/api/mcp"].includes(path);
}

function appConfig(rt: PrivateRuntime) {
  return {
    mode: rt.model ? "live" : "demo",
    paymentsEnabled: Boolean(rt.deps.payments),
    paymentsMode: rt.deps.payments ? "paypal-sandbox" : "none",
    assistant: Boolean(rt.proxy),
    intakeModel: Boolean(rt.model),
    passportSigned: Boolean(rt.passportSecret),
    appUrl: rt.appUrl,
    privateWorkspace: true,
  };
}

/** `/api/marketplace/{area}/{id}/{action}` routes, tried in order; the first handler that recognises the request answers it. */
async function marketplaceRequest(
  rt: PrivateRuntime,
  principal: MarketplaceContext["principal"],
  request: Request,
  path: string,
): Promise<Response> {
  const [area, id, action] = path.slice("/api/marketplace/".length).split("/");
  const context: MarketplaceContext = { rt, principal, request, area, id, action };
  for (const handler of [handleAccount, handleSeller, handleBuyer, handleStaff]) {
    const response = await handler(context);
    if (response) return response;
  }
  throw new AccessError("Marketplace endpoint not found.", 404);
}

export async function privateRequest(request: Request): Promise<Response | undefined> {
  if (!privateWorkspaceEnabled()) return undefined;
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    // Public replayed runs live in a separate simulator runtime and cannot contain private documents.
    const publicId = /^\/api\/(?:sessions|passports)\/([^/]+)/.exec(path)?.[1];
    if (publicId && getRuntime().store.get(publicId)?.input.meta?.scenarioId) return undefined;
    if (path === "/api/sessions" && request.method === "POST") {
      const body = await readJson(request.clone());
      if (body && typeof body === "object" && "scenarioId" in body) return undefined;
    }
    const rt = getPrivateRuntime();

    const open = await handlePublicRoutes(rt, request, url, path);
    if (open) return open;

    const principal = await rt.identity.principal(request);
    // A presented credential that does not resolve (expired, revoked, malformed) must fail visibly, not fall back to public data.
    if (!principal && path !== "/api/mcp" && request.headers.get("authorization"))
      throw new AccessError("This credential is invalid, expired or revoked.", 401);
    if (!principal && path === "/api/mcp") return undefined;
    if (!principal && ["/api/sessions", "/api/portfolio", "/api/config"].includes(path) && request.method === "GET") return undefined;
    if (!principal) throw new AccessError("Sign in to access your private workspace.", 401);
    if (principal.agent) {
      if (!agentMayCall(request.method, path))
        throw new AccessError(
          "Agent credentials can create and read permitted runs; human approval and money actions require browser sign-in.",
        );
    } else requireSameOrigin(request, rt.appUrl);

    if (path === "/api/config") return json(appConfig(rt));
    const runs = await handleRunRoutes(rt, principal, request, url, path);
    if (runs) return runs;
    const tools = await handleToolRoutes(rt, request, path, privateRequest);
    if (tools) return tools;
    if (path.startsWith("/api/marketplace/")) return await marketplaceRequest(rt, principal, request, path);
    // An authenticated request to an unsupported legacy capability must never fall back to public data.
    throw new AccessError("This endpoint is unavailable in the private workspace.", 404);
  } catch (error) {
    if (error instanceof AccessError) return json({ error: error.message }, error.status);
    if (error instanceof ConflictError || error instanceof SessionError) return json({ error: error.message }, 409);
    if (error instanceof ZodError)
      return json({ error: "Invalid request.", issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, 400);
    // Class and database code only: messages can carry record contents.
    const detail = error instanceof Error ? { error: error.name, code: (error as { code?: unknown }).code } : { error: "unknown" };
    console.error(JSON.stringify({ event: "private_request_failed", path: new URL(request.url).pathname, ...detail }));
    return json({ error: "The private workspace is temporarily unavailable. No operation was silently retried." }, 503);
  }
}
