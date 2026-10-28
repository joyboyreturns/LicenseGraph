import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildFlow } from "../src/dashboard/money-flow";

describe("buildFlow", () => {
  it("adds up what each payee received across runs, largest first", () => {
    const flow = buildFlow([
      { payee: "Tapeloop", amount: 340 },
      { payee: "Marlow Voice", amount: 210 },
      { payee: "Tapeloop", amount: 200 },
      { payee: "Greyscale Lane", amount: 140 },
    ])!;
    expect(flow.total).toBe(890);
    expect(flow.lines.map((l) => [l.payee, l.amount])).toEqual([["Tapeloop", 540], ["Marlow Voice", 210], ["Greyscale Lane", 140]]);
    expect(flow.lines[0]!.sharePct).toBeCloseTo((540 / 890) * 100, 10);
  });

  it("skips rows with no positive dollar amount, and says nothing when none are left", () => {
    expect(buildFlow([{ payee: "A", amount: null }, { payee: "B", amount: 0 }, { payee: "C", amount: "abc" }])).toBeUndefined();
    expect(buildFlow([])).toBeUndefined();
    expect(buildFlow([{ payee: "A", amount: null }, { payee: "B", amount: "12.50" }])!.lines).toEqual([{ payee: "B", amount: 12.5, sharePct: 100 }]);
  });

  it("names a payee that has no name, rather than dropping the money", () => {
    expect(buildFlow([{ payee: "", amount: 5 }])!.lines[0]!.payee).toBe("Unnamed payee");
  });

  it("shares add to 100 and amounts to the total", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ payee: fc.constantFrom("a", "b", "c", "d"), amount: fc.integer({ min: 1, max: 100_000 }).map((c) => c / 100) }), { minLength: 1, maxLength: 20 }), (rows) => {
        const flow = buildFlow(rows)!;
        expect(flow.lines.reduce((s, l) => s + l.sharePct, 0)).toBeCloseTo(100, 8);
        expect(Math.round(flow.lines.reduce((s, l) => s + l.amount, 0) * 100)).toBe(Math.round(flow.total * 100));
        expect(flow.lines.map((l) => l.amount)).toEqual([...flow.lines.map((l) => l.amount)].sort((x, y) => y - x));
      }),
    );
  });
});
