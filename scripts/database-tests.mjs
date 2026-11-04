import { spawnSync } from "node:child_process";
import pg from "pg";

// The suites write approved offers, users and ledger rows sealed with throwaway keys. They must never share a
// database with the running app, so they always run in "<name>_test", recreated empty on every run.
const source = process.env.DATABASE_URL;
if (!source) throw new Error("Set DATABASE_URL to the local PostgreSQL server.");
const url = new URL(source);
const base = decodeURIComponent(url.pathname.slice(1));
if (!base) throw new Error("DATABASE_URL must name a database.");
const testName = base.endsWith("_test") ? base : `${base}_test`;
if (!/^[a-z0-9_]{1,50}$/.test(testName)) throw new Error("Unsupported database name for the isolated test database.");

const maintenance = new URL(source);
maintenance.pathname = "/postgres";
const admin = new pg.Client({ connectionString: maintenance.toString() });
await admin.connect();
try {
  // Disposable by design: queued jobs and rows from an earlier run must never leak into this one.
  await admin.query(`DROP DATABASE IF EXISTS ${testName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${testName}`);
} finally {
  await admin.end();
}
url.pathname = `/${testName}`;
const testUrl = url.toString();

// Apply the real migrations so schema drift between the app and the tests is caught here.
const migrate = spawnSync(process.execPath, ["--import", "tsx", "scripts/database-migrate.ts"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl },
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["tests/storage.integration.test.ts", "tests/marketplace.integration.test.ts", "tests/operations.integration.test.ts"];
const result = spawnSync(process.execPath, ["./node_modules/vitest/vitest.mjs", "run", "--no-file-parallelism", ...files], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: testUrl, RUN_DATABASE_TESTS: "1" },
});
process.exitCode = result.status ?? 1;
