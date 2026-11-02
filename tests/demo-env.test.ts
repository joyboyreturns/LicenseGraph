import { describe, expect, it } from "vitest";
import { demoEnvironment } from "../scripts/demo-env.mjs";

describe("offline demo environment", () => {
  it("isolates credentials, recipients and payout failure settings from the shell", () => {
    const env = demoEnvironment({
      AI_GATEWAY_API_KEY: "key", LICENSEGRAPH_MODEL: "model", PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "secret", LICENSEGRAPH_CREATOR_EMAILS: "private@example.com",
      LICENSEGRAPH_SIMULATOR_FAIL_FIRST_PAYOUT: "1", LICENSEGRAPH_MODE: "live", LICENSEGRAPH_PAYMENTS: "paypal",
    }, { dataDir: "/tmp/demo", port: "3300", failFirstPayout: false });
    expect(env).toMatchObject({
      AI_GATEWAY_API_KEY: "", LICENSEGRAPH_MODEL: "", PAYPAL_CLIENT_ID: "", PAYPAL_CLIENT_SECRET: "",
      LICENSEGRAPH_CREATOR_EMAILS: "", LICENSEGRAPH_SIMULATOR_FAIL_FIRST_PAYOUT: "0",
      LICENSEGRAPH_MODE: "demo", LICENSEGRAPH_PAYMENTS: "simulator", APP_URL: "http://localhost:3300",
    });
  });

  it("allows a deliberate payout-failure demonstration", () => {
    expect(demoEnvironment({}, { dataDir: "/tmp/demo", port: "3000", failFirstPayout: true }).LICENSEGRAPH_SIMULATOR_FAIL_FIRST_PAYOUT).toBe("1");
  });
});
