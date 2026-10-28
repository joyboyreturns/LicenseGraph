import type { PassportCheck } from "./passport";

/** A passport check as plain text, one line per check, for a terminal or a CI log. */
export function formatReport(result: { ok: boolean; checks: PassportCheck[] }): string {
  const lines = result.checks.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.label}: ${c.detail}`);
  const failed = result.checks.filter((c) => !c.ok).length;
  lines.push(result.ok ? `All ${result.checks.length} checks passed.` : `${failed} of ${result.checks.length} checks failed.`);
  return lines.join("\n");
}
