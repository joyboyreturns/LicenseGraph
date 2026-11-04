import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const path = ".env.local-infra";
if (existsSync(path)) throw new Error("Local infrastructure secrets already exist; refusing to replace them.");
const password = () => randomBytes(24).toString("hex");
const databasePassword = password();
writeFileSync(
  path,
  [
    `LOCAL_DATABASE_PASSWORD=${databasePassword}`,
    `LOCAL_IDENTITY_DATABASE_PASSWORD=${password()}`,
    `LOCAL_IDENTITY_ADMIN_PASSWORD=${password()}`,
    `DATABASE_URL=postgresql://licensegraph:${databasePassword}@127.0.0.1:55432/licensegraph`,
    "LICENSEGRAPH_STORAGE=postgres",
    "LICENSEGRAPH_STORAGE_KEY_ID=local1",
    `LICENSEGRAPH_STORAGE_KEYS=${JSON.stringify({ local1: randomBytes(32).toString("hex") })}`,
    "OIDC_ISSUER=http://localhost:8081/realms/licensegraph",
    "OIDC_CLIENT_ID=licensegraph",
    "APP_URL=http://localhost:3000",
  ].join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log("Created ignored local configuration. Start services with: docker compose --env-file .env.local-infra up -d");
