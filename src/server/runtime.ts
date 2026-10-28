import { join, resolve } from "node:path";
import { greedyProposer } from "../agent/greedy";
import { createLlmProposer } from "../agent/llm";
import { FileSessionRepository } from "../app-logic/persistence";
import { SessionStore, type Deps } from "../app-logic/session";
import { demoModel } from "../demo/mock-model";
import { createGatewayModel, gatewayConfigFromEnv, type ModelClient } from "../extraction/model";
import { configFromEnv, createPayPalClient } from "../payments/paypal";
import { createPayPalSimulator, type PayPalSimulator } from "../payments/simulator";
import { createLlmProxy, limitsFromEnv } from "./llm-proxy";

export type Mode = "demo" | "live";

export interface Runtime {
  mode: Mode;
  /** Gateway model id in live mode. Never a secret. */
  model?: string;
  paymentsEnabled: boolean;
  /** Which payment backend is live: the real PayPal Sandbox, the offline simulator, or none. */
  paymentsMode: "paypal-sandbox" | "simulator" | "none";
  simulator?: PayPalSimulator;
  /** Server-side model access for the dashboard assistant. */
  llmProxy?: ReturnType<typeof createLlmProxy>;
  /** Reads plain-English briefs; absent without a gateway key (the local reader is used). */
  intakeModel?: ModelClient;
  /** Runs for the built-in scenarios: recorded model output and the deterministic baseline proposer. */
  demoDeps: Deps;
  deps: Deps;
  store: SessionStore;
  passportSecret?: string;
  appUrl: string;
}

/** The public address: APP_URL, else the one Render provides, else local. PayPal and passport QR codes point at it. */
const appUrl = () => (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");

function build(): Runtime {
  const hasGateway = Boolean(process.env.AI_GATEWAY_API_KEY && process.env.LICENSEGRAPH_MODEL);
  const mode: Mode = process.env.LICENSEGRAPH_MODE === "demo" ? "demo" : process.env.LICENSEGRAPH_MODE === "live" || hasGateway ? "live" : "demo";

  const hasPayPal = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  // The simulator runs only when asked for (or when forced with LICENSEGRAPH_PAYMENTS=simulator), never in place of real credentials by accident.
  const forced = process.env.LICENSEGRAPH_PAYMENTS;
  const useSimulator = forced === "simulator" || (!hasPayPal && forced !== "none" && process.env.LICENSEGRAPH_SIMULATOR === "1");
  const simulator = useSimulator ? createPayPalSimulator({ appUrl, failFirstPayout: process.env.LICENSEGRAPH_SIMULATOR_FAIL_FIRST_PAYOUT === "1" }) : undefined;
  const payments = simulator ?? (hasPayPal && forced !== "none" ? createPayPalClient(configFromEnv()) : undefined);
  const paymentsMode: Runtime["paymentsMode"] = simulator ? "simulator" : payments ? "paypal-sandbox" : "none";
  const paymentsEnabled = paymentsMode !== "none";
  const payeeOverrides = (process.env.LICENSEGRAPH_CREATOR_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);

  let model: ModelClient = demoModel;
  let proposer = greedyProposer;
  let modelId: string | undefined;
  let llmProxy: Runtime["llmProxy"];
  let intakeModel: ModelClient | undefined;
  if (hasGateway) {
    // createGatewayModel refuses any model the gateway does not list as free.
    const config = gatewayConfigFromEnv();
    intakeModel = createGatewayModel(config);
    llmProxy = createLlmProxy(config, limitsFromEnv());
    if (mode === "live") {
      model = intakeModel;
      proposer = createLlmProposer(model);
      modelId = config.model;
    }
  }

  const common = {
    payments,
    paymentsMode: paymentsMode === "none" ? undefined : paymentsMode,
    payeeOverrides: payeeOverrides.length ? payeeOverrides : undefined,
    returnUrl: (id: string) => `${appUrl()}/api/sessions/${id}/return`,
    cancelUrl: (id: string) => `${appUrl()}/run/${id}`,
  };
  const dataDir = resolve(process.env.LICENSEGRAPH_DATA_DIR ?? join(process.cwd(), ".data"));

  return {
    mode,
    model: modelId,
    paymentsEnabled,
    paymentsMode,
    simulator,
    llmProxy,
    intakeModel,
    passportSecret: process.env.LICENSEGRAPH_PASSPORT_SECRET || undefined,
    appUrl: appUrl(),
    store: new SessionStore(500, new FileSessionRepository(join(dataDir, "sessions"))),
    deps: { model, proposer, ...common },
    demoDeps: { model: demoModel, proposer: greedyProposer, ...common },
  };
}

const g = globalThis as unknown as { __licensegraph?: Runtime };

/** One runtime per server process, kept across hot reloads. */
export function getRuntime(): Runtime {
  return (g.__licensegraph ??= build());
}
