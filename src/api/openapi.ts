import { z } from "zod";
import { sessionInputSchema } from "../server/session-input";
import * as S from "./schemas";

/**
 * The OpenAPI 3.1 description of the HTTP API. Component schemas come from the same zod schemas the
 * server validates with (or that tests parse real responses with), so the document is generated, not
 * hand-maintained. `tests/openapi.test.ts` fails if a route exists that this document does not list.
 */

type Json = Record<string, unknown>;

const RunInput = sessionInputSchema.meta({ id: "RunInput", description: "Your own licences, read live by the model. Needs a server with a model; use scenarioId otherwise." });
const ScenarioStart = z.object({ scenarioId: z.string(), handoff: z.boolean().optional() }).meta({ id: "ScenarioStart", description: "Replay a built-in scenario from recorded model output." });
const IntakeInput = z.object({ text: z.string().min(5).max(2000) }).meta({ id: "IntakeInput" });
const AskInput = z.object({ question: z.string().min(3).max(400) }).meta({ id: "AskInput" });
const ApproveInput = z.object({ approvedBy: z.string().describe("Who is approving this exact bundle.") }).meta({ id: "ApproveInput" });
const ClaimInput = z.object({ token: z.string().describe("The one-time token from the claim link an agent was given.") }).meta({ id: "ClaimInput" });
const RunId = z.object({ id: z.string() });

const registry = z.registry<{ id?: string }>();
for (const s of [S.Project, S.Offer, S.LedgerEvent, S.SessionView, S.RunCreated, S.RunSummary, S.Passport, S.PassportVerification, S.ApiError, S.BriefReading, S.Answer, S.Health, S.Config, S.Scenario, RunInput, ScenarioStart, IntakeInput, AskInput, ApproveInput, ClaimInput]) {
  registry.add(s, z.globalRegistry.get(s) ?? {});
}

function components(): Record<string, Json> {
  const out = z.toJSONSchema(registry, { target: "draft-2020-12", io: "input", unrepresentable: "any", uri: (id) => `#/components/schemas/${id}` }) as { schemas: Record<string, Json> };
  const schemas: Record<string, Json> = {};
  // Runs and responses are outputs; check the output shape of the ones the server produces.
  const output = z.toJSONSchema(registry, { target: "draft-2020-12", io: "output", unrepresentable: "any", uri: (id) => `#/components/schemas/${id}` }) as { schemas: Record<string, Json> };
  for (const id of Object.keys(out.schemas)) {
    const pick = ["RunInput", "ScenarioStart", "IntakeInput", "AskInput", "ApproveInput", "ClaimInput"].includes(id) ? out.schemas[id]! : output.schemas[id]!;
    const { $schema: _s, $id: _d, id: _i, ...rest } = pick as Json;
    schemas[id] = rest;
  }
  return schemas;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const body = (name: string) => ({ required: true, content: { "application/json": { schema: ref(name) } } });
const ok = (description: string, schema: Json, status = "200") => ({ [status]: { description, content: { "application/json": { schema } } } });
const err = (...codes: [string, string][]) => Object.fromEntries(codes.map(([c, d]) => [c, { description: d, content: { "application/json": { schema: ref("Error") } } }]));
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" }, description: "The run id." };
const owner = [{ ownerCookie: [] }];

export function buildOpenApi(serverUrl = "http://localhost:3000"): Json {
  void RunId;
  return {
    openapi: "3.1.0",
    info: {
      title: "LicenseGraph API",
      version: "1.0.0",
      summary: "Check creative licences against a project, then pay the creators.",
      description:
        "An AI agent reads licences and proposes the cheapest bundle. A deterministic rules engine verifies it against the project and rejects anything that breaks a term. A person approves, PayPal Orders and Payouts settle in the Sandbox, and a Licence Passport lets anyone check the result.\n\n" +
        "Money moves only after a person approves. A run an agent starts with `handoff: true` cannot be approved or paid until a person takes control with the one-time claim link. Approve, pay, capture, payouts and refund need the `lg_owner` cookie of the browser that started (or claimed) the run.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: serverUrl, description: "This server" }],
    tags: [
      { name: "Runs", description: "Start a run, follow it, and settle it." },
      { name: "Passports", description: "The independently checkable record of a paid run." },
      { name: "Intake", description: "Plain-English helpers." },
      { name: "Service", description: "Health, configuration and demo data." },
    ],
    paths: {
      "/api/sessions": {
        post: {
          operationId: "startRun",
          tags: ["Runs"],
          summary: "Start a run",
          description: "Replay a built-in scenario (`scenarioId`) or read your own licences with the live model. Set `handoff: true` when an agent starts the run for a person: the response then carries a one-time `handoff.claimUrl` and no cookie is set.",
          requestBody: { required: true, content: { "application/json": { schema: { oneOf: [ref("ScenarioStart"), ref("RunInput")] } } } },
          responses: { ...ok("The run was created and is being read in the background. Poll `GET /api/sessions/{id}`.", ref("RunCreated"), "201"), ...err(["400", "The input is invalid, or your own licences need a model this server does not have."], ["429", "Too many runs in progress."]) },
        },
        get: { operationId: "listRuns", tags: ["Runs"], summary: "List your runs", description: "The caller's own runs, newest first.", security: owner, responses: ok("Your runs.", { type: "object", properties: { runs: { type: "array", items: ref("RunSummary") } }, required: ["runs"] }) },
      },
      "/api/sessions/{id}": {
        get: { operationId: "getRun", tags: ["Runs"], summary: "Get a run", description: "Anyone with the link can read a run. Payout statuses are refreshed from PayPal first.", parameters: [idParam], responses: { ...ok("The run.", ref("Run")), ...err(["404", "No such run."]) } },
      },
      "/api/sessions/{id}/claim": {
        post: {
          operationId: "claimRun",
          tags: ["Runs"],
          summary: "Take control of a run an agent started",
          description: "POST only and single-use: opening the link or previewing it in a chat app changes nothing. Sets the `lg_owner` cookie on success.",
          parameters: [idParam],
          requestBody: body("ClaimInput"),
          responses: { ...ok("You now own the run.", ref("Run")), ...err(["400", "The token is wrong, used, or expired."], ["404", "No such run."]) },
        },
      },
      "/api/sessions/{id}/approve": {
        post: { operationId: "approveRun", tags: ["Runs"], summary: "Approve the verified bundle", description: "Records who approved which exact bundle (by digest). Nothing is charged yet.", security: owner, parameters: [idParam], requestBody: body("ApproveInput"), responses: { ...ok("The run, approved.", ref("Run")), ...err(["400", "The run is not ready to approve."], ["403", "This run belongs to another browser."], ["404", "No such run."]) } },
      },
      "/api/sessions/{id}/pay": {
        post: { operationId: "startPayment", tags: ["Runs"], summary: "Create the PayPal order", description: "Re-checks the approved bundle with the rules engine, then creates a PayPal order. The response carries `order.approveUrl` for the buyer.", security: owner, parameters: [idParam], responses: { ...ok("The run with its order.", ref("Run")), ...err(["403", "This run belongs to another browser."], ["404", "No such run."], ["409", "The rules engine refused the payment."], ["502", "PayPal refused or was unreachable."]) } },
      },
      "/api/sessions/{id}/capture": {
        post: { operationId: "capturePayment", tags: ["Runs"], summary: "Capture the approved order", description: "Captures the order this run created, checks the captured amount against the bundle, then pays the creators.", security: owner, parameters: [idParam], responses: { ...ok("The run, captured and settled.", ref("Run")), ...err(["403", "This run belongs to another browser."], ["404", "No such run."], ["409", "The buyer has not approved the order yet (`ORDER_NOT_APPROVED`)."], ["502", "PayPal refused or was unreachable."]) } },
      },
      "/api/sessions/{id}/payouts": {
        post: { operationId: "retryPayouts", tags: ["Runs"], summary: "Retry creator payouts", description: "After a payout failure. Never touches the captured payment.", security: owner, parameters: [idParam], responses: { ...ok("The run.", ref("Run")), ...err(["403", "This run belongs to another browser."], ["404", "No such run."], ["502", "PayPal refused or was unreachable."]) } },
      },
      "/api/sessions/{id}/refund": {
        post: { operationId: "refundPurchase", tags: ["Runs"], summary: "Refund the buyer", description: "Returns the whole captured payment. Refused unless it is certain no creator was paid. No passport is issued for a refunded run.", security: owner, parameters: [idParam], responses: { ...ok("The refunded run.", ref("Run")), ...err(["400", "Creators may have been paid, or the payment was already refunded."], ["403", "This run belongs to another browser."], ["404", "No such run."], ["502", "PayPal refused or was unreachable."]) } },
      },
      "/api/sessions/{id}/return": {
        get: { operationId: "paypalReturn", tags: ["Runs"], summary: "Where PayPal sends the buyer after approval", description: "Captures the run's own order, then redirects to the run page. Browser flow; not meant for API clients.", security: owner, parameters: [idParam], responses: { "307": { description: "Redirect to the run page." } } },
      },
      "/api/sessions/{id}/ask": {
        post: { operationId: "askAboutRun", tags: ["Runs"], summary: "Ask a question about a run", description: "Answers are grounded in the run's recorded facts, and every offer id cited exists in the run. Falls back to a deterministic answer if the model is unavailable.", parameters: [idParam], requestBody: body("AskInput"), responses: { ...ok("The answer.", ref("Answer")), ...err(["400", "Ask a question about this run."], ["404", "No such run."], ["413", "The question is too long."]) } },
      },
      "/api/passports/{id}": {
        get: { operationId: "getPassport", tags: ["Passports"], summary: "Get the Licence Passport", description: "Issued once the payment is captured. Add `?download=1` to save it as a file.", parameters: [idParam, { name: "download", in: "query", required: false, schema: { type: "string" } }], responses: { ...ok("The passport.", ref("Passport")), ...err(["404", "No such run."], ["409", "Not captured yet, or the purchase was refunded."]) } },
      },
      "/api/passports/{id}/verify": {
        get: { operationId: "verifyPassport", tags: ["Passports"], summary: "Verify a passport on the server", description: "Every content check, plus whether this server signed it. The browser can repeat the content checks without the server.", parameters: [idParam], responses: { ...ok("The checks.", ref("PassportVerification")), ...err(["404", "No such run."], ["409", "Not captured yet, or the purchase was refunded."]) } },
      },
      "/api/passports/{id}/qr": {
        get: { operationId: "getPassportQr", tags: ["Passports"], summary: "QR code for the passport page", parameters: [idParam], responses: { "200": { description: "An SVG QR code.", content: { "image/svg+xml": { schema: { type: "string" } } } }, "404": { description: "No such run." } } },
      },
      "/api/intake": {
        post: { operationId: "readBrief", tags: ["Intake"], summary: "Turn a plain-English brief into a project", description: "Uses the model when one is configured and always falls back to a local reader. Assumptions are listed separately from what the text said.", requestBody: body("IntakeInput"), responses: { ...ok("What was read.", ref("BriefReading")), ...err(["400", "Describe your project in a sentence or two."], ["413", "Too long."]) } },
      },
      "/api/scenarios": {
        get: { operationId: "listScenarios", tags: ["Service"], summary: "Built-in scenarios", description: "With the licence text, so a client can show what the agent will read. Payee emails are left out.", responses: ok("The scenarios.", { type: "object", properties: { scenarios: { type: "array", items: ref("Scenario") } }, required: ["scenarios"] }) },
      },
      "/api/portfolio": {
        get: { operationId: "getPortfolio", tags: ["Runs"], summary: "Every run in full", description: "Your runs with licence text removed, newest first. Feeds the dashboard.", security: owner, responses: ok("The runs.", { type: "object", properties: { views: { type: "array", items: ref("Run") } }, required: ["views"] }) },
      },
      "/api/openapi.json": { get: { operationId: "getOpenApi", tags: ["Service"], summary: "This document", responses: { "200": { description: "The OpenAPI 3.1 description of this API.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } } } },
      "/api/config": { get: { operationId: "getConfig", tags: ["Service"], summary: "What this server can do", responses: ok("The configuration. Contains no secrets.", ref("Config")) } },
      "/api/health": { get: { operationId: "getHealth", tags: ["Service"], summary: "Health check", responses: ok("The server is up.", ref("Health")) } },
      "/api/llm": {
        post: { operationId: "assistantProxy", tags: ["Service"], summary: "Model proxy for the AG Studio assistant", description: "Used by the dashboard's built-in assistant. Forwards to the configured free model.", requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, responses: { "200": { description: "The model's reply.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "503": { description: "No model is configured." } } },
      },
      "/api/simulator/orders/{id}": {
        get: { operationId: "describeSimulatedOrder", tags: ["Service"], summary: "Simulated checkout page data", description: "Exists only when the offline payment simulator is running.", parameters: [idParam], responses: { "200": { description: "The simulated order." }, ...err(["404", "No simulator, or no such order."]) } },
        post: { operationId: "approveSimulatedOrder", tags: ["Service"], summary: "Approve a simulated order", description: "The buyer pressing Approve at the simulated checkout. Exists only when the offline payment simulator is running.", parameters: [idParam], responses: { "200": { description: "Approved; says where to send the browser." }, ...err(["404", "No simulator, or no such order."]) } },
      },
    },
    components: {
      securitySchemes: { ownerCookie: { type: "apiKey", in: "cookie", name: "lg_owner", description: "An unguessable id set when a browser starts or claims a run. Only that browser may approve, pay, refund or list the run." } },
      schemas: components(),
    },
  };
}
