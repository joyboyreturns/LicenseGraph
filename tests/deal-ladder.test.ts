import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildLadders, ladderSummary } from "../src/dashboard/deal-ladder";

const row = (deal: string | null, step: number, total: number | null, stage = "Run") => ({ deal, stage, step, total });

describe("buildLadders", () => {
  it("orders a deal's steps, works out each step's movement and the net change", () => {
    const [l] = buildLadders([row("Harbour", 3, 262, "Changed brief"), row("Harbour", 1, 329, "First run"), row("Harbour", 2, 294, "After a licensor reply")]);
    expect(l!.steps.map((s) => [s.step, s.total, s.change])).toEqual([[1, 329, null], [2, 294, -35], [3, 262, -32]]);
    expect(l!.netChange).toBe(-67);
  });

  it("skips runs that belong to no deal and deals of one run", () => {
    expect(buildLadders([row(null, 1, 100), row("", 1, 100), row("Solo", 1, 100), row("Two", 1, 10), row("Two", 2, 20)]).map((l) => l.deal)).toEqual(["Two"]);
  });

  it("treats a step with no bundle as no total, and measures the next step against the last total it can", () => {
    const [l] = buildLadders([row("D", 1, 300), row("D", 2, null, "After a reply"), row("D", 3, 250)]);
    expect(l!.steps.map((s) => s.change)).toEqual([null, null, -50]);
    expect(l!.netChange).toBe(-50);
    expect(buildLadders([row("D", 1, null), row("D", 2, 250)])[0]!.netChange).toBeNull();
  });

  it("describes a ladder in one sentence", () => {
    expect(ladderSummary(buildLadders([row("Harbour", 1, 329, "First run"), row("Harbour", 2, 294, "Changed brief")])[0]!)).toBe("Harbour: First run $329.00, then Changed brief $294.00, $35.00 less overall");
  });

  it("is exact to the cent for any totals, and its steps always run in order", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 6 }), (centsList) => {
        const rows = centsList.map((c, i) => row("D", centsList.length - i, c / 100));
        const l = buildLadders(rows)[0]!;
        expect(l.steps.map((s) => s.step)).toEqual([...l.steps.map((s) => s.step)].sort((a, b) => a - b));
        const byStep = [...rows].sort((a, b) => a.step - b.step);
        expect(Math.round(l.netChange! * 100)).toBe(Math.round(byStep.at(-1)!.total! * 100) - Math.round(byStep[0]!.total! * 100));
      }),
    );
  });
});
