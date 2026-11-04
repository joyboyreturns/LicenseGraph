import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/marketplace-browser",
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "node --env-file=.env.local-infra ./node_modules/next/dist/bin/next start -p 3000",
    url: "http://localhost:3000/api/marketplace/ready",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AI_GATEWAY_API_KEY: "",
      LICENSEGRAPH_MODEL: "",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      LICENSEGRAPH_PAYMENTS: "none",
      LICENSEGRAPH_PASSPORT_SECRET: "local-private-browser-test-key",
    },
  },
});
