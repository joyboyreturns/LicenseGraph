import { greedyProposer } from "../agent/greedy";
import { createLlmProposer } from "../agent/llm";
import { Identity } from "../auth/identity";
import { createGatewayModel, gatewayConfigFromEnv, minIntervalFromEnv } from "../extraction/model";
import { configFromEnv, createPayPalClient } from "../payments/paypal";
import { createLlmProxy, limitsFromEnv } from "../server/llm-proxy";
import { RecordCipher } from "../storage/crypto";
import { Database } from "../storage/database";
import { JobQueue } from "../storage/jobs";
import { reserveModelSlot } from "../storage/model-slots";
import { RunRepository } from "../storage/runs";
import { Marketplace } from "./service";
import { MarketplaceWorker } from "./worker";
import type { Deps } from "../app-logic/session";

export const privateWorkspaceEnabled = () => process.env.LICENSEGRAPH_STORAGE === "postgres";
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Private workspace configuration is missing ${name}.`);
  return value;
}
function buildPrivateRuntime() {
  const db = Database.connect(required("DATABASE_URL"));
  const cipher = new RecordCipher(required("LICENSEGRAPH_STORAGE_KEY_ID"), JSON.parse(required("LICENSEGRAPH_STORAGE_KEYS")));
  const appUrl = required("APP_URL").replace(/\/$/, "");
  const identity = new Identity(
    db,
    cipher,
    appUrl,
    required("OIDC_ISSUER"),
    required("OIDC_CLIENT_ID"),
    process.env.OIDC_CLIENT_SECRET || undefined,
  );
  const runs = new RunRepository(db, cipher);
  const queue = new JobQueue(db, cipher);
  const market = new Marketplace(runs, queue);
  const config = process.env.AI_GATEWAY_API_KEY && process.env.LICENSEGRAPH_MODEL ? gatewayConfigFromEnv() : undefined;
  const guarded = config
    ? { ...config, minIntervalMs: 0, reserveSlot: () => reserveModelSlot(db, `gateway:${config.model}`, minIntervalFromEnv()) }
    : undefined;
  const model = guarded ? createGatewayModel(guarded) : undefined;
  const payments = process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET ? createPayPalClient(configFromEnv()) : undefined;
  const deps: Deps = {
    model: model ?? {
      complete: async () => {
        throw new Error("Custom document extraction needs a configured free model.");
      },
    },
    proposer: model ? createLlmProposer(model) : greedyProposer,
    payments,
    paymentsMode: "paypal-sandbox",
    extractionAttempts: 1,
    stopOnProposalError: true,
    returnUrl: (id) => `${appUrl}/api/sessions/${id}/return`,
    cancelUrl: (id) => `${appUrl}/run/${id}`,
  };
  return {
    db,
    cipher,
    appUrl,
    identity,
    runs,
    queue,
    market,
    deps,
    model,
    proxy: guarded ? createLlmProxy(guarded, { ...limitsFromEnv(), minIntervalMs: 0 }) : undefined,
    worker: new MarketplaceWorker(market, deps),
    passportSecret: process.env.LICENSEGRAPH_PASSPORT_SECRET || undefined,
  };
}
export type PrivateRuntime = ReturnType<typeof buildPrivateRuntime>;
const globalRuntime = globalThis as unknown as { __licensegraphPrivate?: PrivateRuntime };
export function getPrivateRuntime(): PrivateRuntime {
  if (!privateWorkspaceEnabled()) throw new Error("Private workspace is not configured.");
  return (globalRuntime.__licensegraphPrivate ??= buildPrivateRuntime());
}
