import { describe, expect, it } from "vitest";
import { buildMatrix, readRow } from "../src/dashboard/rule-matrix";

describe("the rule matrix", () => {
  const input = [
    { row: "song", column: "territory", value: 2 },
    { row: "song", column: "term", value: 1 },
    { row: "image", column: "commercial-use", value: 4 },
    { row: "image", column: "territory", value: 1 },
    { row: "song", column: "territory", value: 1 },
  ];

  it("adds repeated pairs, orders the heaviest rows and columns first (ties alphabetically), and scales colour to the busiest cell", () => {
    const m = buildMatrix(input);
    expect(m.rows).toEqual(["image", "song"]);
    expect(m.columns).toEqual(["commercial-use", "territory", "term"]);
    expect(m.total).toBe(9);
    expect(m.max).toBe(4);
    expect(m.cells[1]![1]).toEqual({ count: 3, intensity: 0.75 });
    expect(m.cells[0]![0]).toEqual({ count: 4, intensity: 1 });
    expect(m.cells[0]![2]).toBeUndefined();
  });

  it("counts every row once: the grid total equals the input total", () => {
    const m = buildMatrix(input);
    const sum = m.cells.flat().reduce((n, c) => n + (c?.count ?? 0), 0);
    expect(sum).toBe(input.reduce((n, r) => n + r.value, 0));
  });

  it("ignores rows with no usable count, and names a missing label", () => {
    const m = buildMatrix([
      { row: "a", column: "x", value: 0 },
      { row: "a", column: "x", value: "n/a" },
      { row: "a", column: "x", value: -3 },
      { row: null, column: "", value: 2 },
    ]);
    expect(m.rows).toEqual(["None"]);
    expect(m.columns).toEqual(["None"]);
    expect(m.total).toBe(2);
  });

  it("is empty, not broken, with nothing to show", () => {
    expect(buildMatrix([])).toEqual({ rows: [], columns: [], cells: [], total: 0, max: 0 });
  });

  it("reads a result row by field id, or by order when the keys differ", () => {
    expect(readRow({ "violations.rule": "term", "violations.asset": "song", "violations.violationId": 3 }, ["violations.asset", "violations.rule", "violations.violationId"])).toEqual({ row: "song", column: "term", value: 3 });
    expect(readRow({ a: "song", b: "term", c: 3 }, ["x", "y", "z"])).toEqual({ row: "song", column: "term", value: 3 });
  });
});
