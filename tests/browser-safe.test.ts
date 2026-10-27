import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Modules the browser imports must not pull in Node-only code, or the page bundle breaks. */
const BROWSER_ENTRIES = ["src/passport/passport.ts", "src/core/rules.ts", "src/core/analysis.ts", "src/core/digest.ts", "src/ledger/chain.ts", "src/intake/brief.ts", "src/dashboard/widget-tools.ts"];

function reachable(entry: string, seen = new Set<string>()): Set<string> {
  const file = resolve(entry);
  if (seen.has(file)) return seen;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  // Value imports only: `import type` and `export type` are erased and cannot reach the bundle.
  for (const m of source.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["'](\.[^"']+)["']/gm)) {
    const base = resolve(dirname(file), m[1]!);
    const next = [`${base}.ts`, `${base}/index.ts`].find(existsSync);
    if (next) reachable(next, seen);
  }
  return seen;
}

describe("browser-safe modules", () => {
  it.each(BROWSER_ENTRIES)("%s imports nothing from Node", (entry) => {
    for (const file of reachable(entry)) {
      const imports = [...readFileSync(file, "utf8").matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
      expect(imports.filter((i) => i.startsWith("node:") || ["fs", "path", "crypto"].includes(i)), `${file} imports Node modules`).toEqual([]);
    }
  });
});
