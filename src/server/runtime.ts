import { greedyProposer } from "../agent/greedy";
import { createLlmProposer } from "../agent/llm";
import { SessionStore, type Deps } from "../app-logic/session";
import { demoModel } from "../demo/mock-model";
import { createGatewayModel, gatewayConfigFromEnv } from "../extraction/model";
import { configFromEnv, createPayPalClient } from "../payments/paypal";

export type Mode = "demo" | "live";

export interface Runtime {
  mode: Mode;
  /** Gateway model id in live mode. Never a secret. */
  model?: string;
  paymentsEnabled: boolean;
  deps: Deps;
  store: SessionStore;
}

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

function build(): Runtime {
  const hasGateway = Boolean(process.env.AI_GATEWAY_API_KEY && process.env.LICENSEGRAPH_MODEL);
  const mode: Mode = process.env.LICENSEGRAPH_MODE === "demo" ? "demo" : process.env.LICENSEGRAPH_MODE === "live" || hasGateway ? "live" : "demo";

  const paymentsEnabled = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  const payments = paymentsEnabled ? createPayPalClient(configFromEnv()) : undefined;

  let model = demoModel;
  let proposer = greedyProposer;
  let modelId: string | undefined;
  if (mode === "live") {
    // createGatewayModel refuses any model the gateway does not list as free.
    const config = gatewayConfigFromEnv();
    model = createGatewayModel(config);
    proposer = createLlmProposer(model);
    modelId = config.model;
  }

  return {
    mode,
    model: modelId,
    paymentsEnabled,
    store: new SessionStore(),
    deps: {
      model,
      proposer,
      payments,
      returnUrl: (id) => `${appUrl()}/api/sessions/${id}/return`,
      cancelUrl: (id) => `${appUrl()}/?session=${id}`,
    },
  };
}

const g = globalThis as unknown as { __licensegraph?: Runtime };

/** One runtime per server process, kept across hot reloads. */
export function getRuntime(): Runtime {
  return (g.__licensegraph ??= build());
}
