import { describe, expect, it } from "vitest";
import { RULE_CATALOG } from "../src/core/rules";
import { RULE_NOTES } from "../src/ui/lib/rule-notes";
import { ruleChecks } from "../src/ui/lib/rule-text";

describe("the rules page", () => {
  it("explains every rule the engine has, and nothing it does not", () => {
    expect(Object.keys(RULE_NOTES).sort()).toEqual(RULE_CATALOG.map((r) => r.id).sort());
    for (const r of RULE_CATALOG) {
      const n = RULE_NOTES[r.id]!;
      expect(n.applies.length, r.id).toBeGreaterThan(5);
      expect(n.silent.length, r.id).toBeGreaterThan(5);
      expect((n.checks ?? ruleChecks(r.id)).length, r.id).toBeGreaterThan(10);
    }
  });

  it("describes the bundle-wide rules too", () => {
    for (const id of ["coverage", "duplicate-asset", "currency", "budget"]) expect(ruleChecks(id).length, id).toBeGreaterThan(10);
  });
});
