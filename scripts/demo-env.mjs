/** Build an isolated, no-credentials environment for the offline demo. */
export function demoEnvironment(env, { dataDir, port, failFirstPayout }) {
  return {
    ...env,
    LICENSEGRAPH_MODE: "demo",
    LICENSEGRAPH_PAYMENTS: "simulator",
    AI_GATEWAY_API_KEY: "",
    LICENSEGRAPH_MODEL: "",
    PAYPAL_CLIENT_ID: "",
    PAYPAL_CLIENT_SECRET: "",
    LICENSEGRAPH_CREATOR_EMAILS: "",
    LICENSEGRAPH_DATA_DIR: dataDir,
    LICENSEGRAPH_PASSPORT_SECRET: env.LICENSEGRAPH_PASSPORT_SECRET || "licensegraph-offline-demo-secret",
    APP_URL: env.APP_URL ?? `http://localhost:${port}`,
    LICENSEGRAPH_SIMULATOR_FAIL_FIRST_PAYOUT: failFirstPayout ? "1" : "0",
  };
}
