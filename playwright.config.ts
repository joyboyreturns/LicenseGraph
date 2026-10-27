import { defineConfig } from "@playwright/test";

// End-to-end tests run against the real app in demo mode (offline payment simulator, replayed scenarios).
// Run: npm run test:e2e   (needs a browser once: npx playwright install chromium)
const main = 3300;
const failing = 3301;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure", acceptDownloads: true, viewport: { width: 1440, height: 900 } },
  projects: [
    { name: "main", testIgnore: /payout-retry/, use: { baseURL: `http://localhost:${main}` } },
    { name: "payout-failure", testMatch: /payout-retry/, use: { baseURL: `http://localhost:${failing}` } },
  ],
  webServer: [
    { command: `node scripts/demo.mjs --no-build --port ${main} --data-dir .data-e2e-main --fresh`, url: `http://localhost:${main}/api/health`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: `node scripts/demo.mjs --no-build --port ${failing} --data-dir .data-e2e-failing --fresh --fail-first-payout`, url: `http://localhost:${failing}/api/health`, reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
