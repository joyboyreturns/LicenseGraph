import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getPassport } from "../app/api/passports/[id]/route";
import { GET as getVerify } from "../app/api/passports/[id]/verify/route";
import { GET as getPortfolio } from "../app/api/portfolio/route";
import { GET as getScenarios } from "../app/api/scenarios/route";
import { GET as getHealth } from "../app/api/health/route";
import { GET as getConfig } from "../app/api/config/route";
import { GET as listRuns } from "../app/api/sessions/route";
import { GET as getOpenApi } from "../app/api/openapi.json/route";
import { buildOpenApi } from "../src/api/openapi";
import * as S from "../src/api/schemas";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, reserveForPerson, runPipeline, SessionStore, startPayment, viewOf, type Deps } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { scenarioById } from "../src/demo/scenarios";
import { createPayPalSimulator } from "../src/payments/simulator";
import type { Runtime } from "../src/server/runtime";

type Json = Record<string, any>;
const spec = buildOpenApi() as Json;
const METHODS = ["get", "post", "put", "patch", "delete"];

// Every route.ts under app/api and the public discovery routes, as the OpenAPI path and the HTTP methods it exports.
function routeFiles(dir?: string): { path: string; methods: string[] }[] {
  if (!dir) return ["app/api", "app/.well-known", "app/llms.txt"].flatMap((d) => routeFiles(join(process.cwd(), d)));
  const out: { path: string; methods: string[] }[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === "route.ts") {
      const path = "/" + relative(join(process.cwd(), "app"), dir).replace(/\[(\w+)\]/g, "{$1}");
      const methods = [...readFileSync(full, "utf8").matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]!.toLowerCase());
      out.push({ path, methods });
    }
  }
  return out;
}

describe("the OpenAPI document", () => {
  it("lists every route the app has, with the same methods, and nothing the app lacks", () => {
    const real = Object.fromEntries(routeFiles().map((r) => [r.path, r.methods.sort()]));
    const documented = Object.fromEntries(Object.entries(spec.paths as Json).map(([p, item]) => [p, METHODS.filter((m) => m in (item as Json)).sort()]));
    expect(documented).toEqual(real);
  });

  it("is the same as the committed docs/openapi.json (run `npm run openapi` after changing the API)", () => {
    expect(JSON.parse(readFileSync("docs/openapi.json", "utf8"))).toEqual(JSON.parse(JSON.stringify(spec)));
  });

  it("has only references that resolve, unique operation ids, and every path parameter declared", () => {
    const refs: string[] = [];
    JSON.stringify(spec, (k, v) => (k === "$ref" ? refs.push(v) : v));
    expect(refs.length).toBeGreaterThan(30);
    for (const r of refs) expect(spec.components.schemas[r.replace("#/components/schemas/", "")], r).toBeDefined();

    const ids: string[] = [];
    for (const [path, item] of Object.entries(spec.paths as Json)) {
      for (const m of METHODS.filter((m) => m in item)) {
        const op = item[m];
        ids.push(op.operationId);
        expect(op.summary, `${m} ${path}`).toBeTruthy();
        expect(Object.keys(op.responses).length, `${m} ${path}`).toBeGreaterThan(0);
        for (const p of path.match(/\{(\w+)\}/g) ?? []) expect((op.parameters ?? []).some((x: Json) => x.in === "path" && `{${x.name}}` === p), `${m} ${path} declares ${p}`).toBe(true);
        for (const s of op.security ?? []) for (const name of Object.keys(s)) expect(spec.components.securitySchemes[name]).toBeDefined();
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries no JSON Schema bookkeeping that tools reject", () => {
    expect(JSON.stringify(spec)).not.toMatch(/"\$id"|"\$schema"/);
  });

  it("describes the request bodies the server really validates", () => {
    const input = spec.components.schemas.RunInput;
    expect(input.required).toEqual(expect.arrayContaining(["project", "requiredAssetIds", "documents"]));
    expect(input.properties.documents.maxItems).toBe(12);
    expect(input.properties.documents.items.properties.text.maxLength).toBe(20_000);
  });
});

/** The real handlers, on the offline simulator, answering with what the document promises. */
async function install() {
  const sim = createPayPalSimulator({ appUrl: () => "http://app", settleAfterMs: 0 });
  const deps: Deps = { model: demoModel, proposer: greedyProposer, payments: { createOrder: sim.createOrder, captureOrder: sim.captureOrder, createPayout: sim.createPayout, getPayout: sim.getPayout, refundCapture: sim.refundCapture }, today: () => "2026-11-05" };
  const store = new SessionStore();
  const rt = { mode: "demo", model: undefined, paymentsEnabled: true, paymentsMode: "simulator", appUrl: "http://app", store, deps, demoDeps: deps, passportSecret: "test-secret", llmProxy: undefined, intakeModel: undefined } as unknown as Runtime;
  (globalThis as unknown as { __licensegraph?: Runtime }).__licensegraph = rt;
  const make = () => {
    const sc = scenarioById("documentary")!;
    const s = createSession({ project: { ...sc.project }, requiredAssetIds: [...sc.requiredAssetIds], documents: sc.documents.map((d) => ({ ...d })), meta: { scenarioId: sc.id, runKind: "demo" } });
    store.add(s);
    return s;
  };
  return { sim, deps, make, store };
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const body = async (res: Response) => res.json();

describe("real responses match the published schemas", () => {
  it("a run is valid at every stage: read, handed to a person, paid, and refunded", async () => {
    const { sim, deps, make } = await install();

    const verified = make();
    await runPipeline(verified, deps);
    expect(S.SessionView.parse(JSON.parse(JSON.stringify(viewOf(verified))))).toBeTruthy();

    const agent = make();
    reserveForPerson(agent);
    await runPipeline(agent, deps);
    expect(S.SessionView.parse(JSON.parse(JSON.stringify(viewOf(agent)))).awaitingPerson).toBe(true);

    const paid = make();
    await runPipeline(paid, deps);
    approveSession(paid, "Kiran");
    sim.approveOrder((await startPayment(paid, deps)).id);
    await completePayment(paid, deps);
    const view = S.SessionView.parse(JSON.parse(JSON.stringify(viewOf(paid))));
    expect(view.capture?.captureId).toBeTruthy();
    expect(view.payouts?.lines[0]).toHaveProperty("emailMasked");
    expect(JSON.stringify(view)).not.toMatch(/"email":/);
  });

  it("the passport, its server-side check, and the portfolio", async () => {
    const { sim, deps, make } = await install();
    const s = make();
    await runPipeline(s, deps);
    approveSession(s, "Kiran");
    sim.approveOrder((await startPayment(s, deps)).id);
    await completePayment(s, deps);

    const passport = await body(await getPassport(new Request("http://app"), ctx(s.id)));
    expect(S.Passport.parse(passport).signature?.algorithm).toBe("Ed25519");
    const check = S.PassportVerification.parse(await body(await getVerify(new Request("http://app"), ctx(s.id))));
    expect(check).toMatchObject({ ok: true, signature: "valid" });

    const { views } = await body(await getPortfolio(new Request("http://app")));
    for (const v of views) S.SessionView.parse(v);
    const { runs } = await body(await listRuns(new Request("http://app")));
    for (const r of runs) S.RunSummary.parse(r);
    expect(runs.length).toBeGreaterThan(0);
  });

  it("service endpoints, and an error body", async () => {
    await install();
    S.Health.parse(await body(await getHealth()));
    S.Config.parse(await body(await getConfig()));
    for (const sc of (await body(await getScenarios())).scenarios) S.Scenario.parse(sc);
    const missing = await getPassport(new Request("http://app"), ctx("00000000-0000-0000-0000-000000000000"));
    expect(missing.status).toBe(404);
    S.ApiError.parse(await body(missing));
    const served = await body(await getOpenApi());
    expect(served.openapi).toBe("3.1.0");
    expect(served.servers[0].url).toBe("http://app");
  });
});
