import { z } from "zod";
import { AccessError } from "../../auth/identity";
import type { PrivateRuntime } from "../runtime";
import { json, readJson } from "./common";

/** Brief parsing, the agent tool endpoint and the optional assistant. `dispatch` re-enters the private router for tool calls. */
export async function handleToolRoutes(
  rt: PrivateRuntime,
  request: Request,
  path: string,
  dispatch: (request: Request) => Promise<Response | undefined>,
): Promise<Response | undefined> {
  if (path === "/api/intake") {
    const { parseBrief } = await import("../../intake/brief");
    const body = z.object({ text: z.string().min(5).max(2000) }).parse(await readJson(request));
    return json(await parseBrief(body.text, rt.model));
  }
  if (path === "/api/mcp") {
    const { createLicenseGraphServer } = await import("../../mcp/server");
    const { WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    const server = createLicenseGraphServer({
      baseUrl: rt.appUrl,
      fetch: async (input, init) => {
        const target = new URL(String(input));
        if (target.origin !== new URL(rt.appUrl).origin) throw new AccessError("Agent tool target must be this application.");
        const headers = new Headers(init?.headers);
        for (const name of ["cookie", "authorization"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        headers.set("Origin", new URL(rt.appUrl).origin);
        const forwarded = new Request(target, { ...init, headers });
        const response = await dispatch(forwarded);
        if (response) return response;
        // Public replay handlers do not touch private storage or credentials.
        if (target.pathname === "/api/sessions" && init?.method === "POST")
          return (await import("../../../app/api/sessions/route")).POST(forwarded);
        const publicRun = /^\/api\/sessions\/([^/]+)$/.exec(target.pathname);
        if (publicRun)
          return (await import("../../../app/api/sessions/[id]/route")).GET(forwarded, { params: Promise.resolve({ id: publicRun[1]! }) });
        return json({ error: "Public tool target unavailable." }, 404);
      },
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      void transport.close().catch(() => undefined);
    }
  }
  if (path === "/api/llm") {
    if (!rt.proxy) throw new AccessError("The optional assistant is not configured.", 503);
    return json(await rt.proxy(await readJson(request)));
  }
  return undefined;
}
