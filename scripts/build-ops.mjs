// Bundles the worker and the operations commands into single JavaScript files under dist/ops, so a deployed server
// runs them with plain `node` (no TypeScript loader, no dev dependencies, no node_modules folder needed for them).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

const entries = {
  worker: "scripts/marketplace-worker.ts",
  migrate: "scripts/database-migrate.ts",
  backup: "scripts/database-backup.ts",
  restore: "scripts/database-restore.ts",
  rekey: "scripts/database-rekey.ts",
  "import-legacy": "scripts/import-legacy.ts",
};
mkdirSync("dist/ops", { recursive: true });
await build({
  entryPoints: entries,
  outdir: "dist/ops",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  external: ["pg-native"],
  // Bundled CommonJS dependencies still call require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});
