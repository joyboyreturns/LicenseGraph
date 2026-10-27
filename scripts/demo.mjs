#!/usr/bin/env node
// Runs LicenseGraph with no accounts and no keys: the replayed demo scenarios and the offline payment simulator.
//   npm run demo                      http://localhost:3000
//   npm run demo -- --port 3300       another port
// Flags: --port N, --data-dir DIR (default .data-demo), --fresh (start with no saved runs), --build (always rebuild),
//        --no-build (never build), --build-only (build if needed, then exit), --fail-first-payout (show the payout retry path).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const port = value("port", "3000");
const dataDir = resolve(root, value("data-dir", ".data-demo"));
const next = resolve(root, "node_modules/next/dist/bin/next");

if (!existsSync(next)) {
  console.error("Dependencies are not installed. Run `npm install` first.");
  process.exit(1);
}
if (flag("fresh")) rmSync(dataDir, { recursive: true, force: true });

const needsBuild = !flag("no-build") && (flag("build") || !existsSync(resolve(root, ".next/BUILD_ID")));
if (needsBuild) {
  console.log("Building LicenseGraph (first run only, about a minute)...");
  const built = spawnSync(process.execPath, [next, "build"], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
if (flag("build-only")) process.exit(0);

// Empty values override any .env on this machine, so the demo never touches real accounts or models.
const env = {
  ...process.env,
  LICENSEGRAPH_MODE: "demo",
  LICENSEGRAPH_PAYMENTS: "simulator",
  AI_GATEWAY_API_KEY: "",
  LICENSEGRAPH_MODEL: "",
  PAYPAL_CLIENT_ID: "",
  PAYPAL_CLIENT_SECRET: "",
  LICENSEGRAPH_DATA_DIR: dataDir,
  APP_URL: process.env.APP_URL ?? `http://localhost:${port}`,
  ...(flag("fail-first-payout") ? { LICENSEGRAPH_SIMULATOR_FAIL_FIRST_PAYOUT: "1" } : {}),
};

console.log(`LicenseGraph demo: ${env.APP_URL}  (offline: replayed scenarios, payment simulator, no money moves)`);
const server = spawn(process.execPath, [next, "start", "-p", port], { cwd: root, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 0));
