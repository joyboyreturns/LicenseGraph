import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dealHistory, type HistoryRun } from "../src/core/deal-history";

const run = (id: string, minute: number, extra: Partial<HistoryRun> = {}): HistoryRun => ({ id, createdAt: `2026-11-01T10:${String(minute).padStart(2, "0")}:00Z`, phase: "verified", paid: false, ...extra });

describe("dealHistory", () => {
  it("lists the whole negotiation from any run in it, oldest first, with how each total moved", () => {
    const runs = [
      run("a", 0, { phase: "failed" }),
      run("b", 1, { revisedFrom: "a", totalCents: 69_000, currency: "USD" }),
      run("c", 2, { rebriefedFrom: "b", totalCents: 62_000, currency: "USD", paid: true }),
      run("other", 3, { totalCents: 1, currency: "USD" }),
    ];
    for (const from of ["a", "b", "c"]) {
      const h = dealHistory(runs, from);
      expect(h.map((s) => s.id)).toEqual(["a", "b", "c"]);
      expect(h.filter((s) => s.current).map((s) => s.id)).toEqual([from]);
    }
    const h = dealHistory(runs, "c");
    expect(h.map((s) => s.kind)).toEqual(["original", "reply", "brief"]);
    // The first run bought nothing, so there is no movement to show for the reply; the brief change moved it by $70 down.
    expect(h.map((s) => s.deltaCents)).toEqual([null, null, -7_000]);
    expect(h[2]).toMatchObject({ paid: true, totalCents: 62_000 });
  });

  it("is empty for a run that stands alone, an unknown run, or a link to a run that is not in the list", () => {
    expect(dealHistory([run("a", 0), run("b", 1)], "a")).toEqual([]);
    expect(dealHistory([run("a", 0)], "missing")).toEqual([]);
    expect(dealHistory([run("b", 1, { rebriefedFrom: "gone" })], "b")).toEqual([]);
  });

  it("does not set totals in different currencies against each other", () => {
    const h = dealHistory([run("a", 0, { totalCents: 100, currency: "USD" }), run("b", 1, { rebriefedFrom: "a", totalCents: 90, currency: "EUR" })], "b");
    expect(h[1]!.deltaCents).toBeNull();
  });

  it("finds the same runs from every run in a chain, for any chain", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 0, max: 7 }), (n, pick) => {
        const runs = Array.from({ length: n }, (_, i) => run(`r${i}`, i, i === 0 ? {} : i % 2 ? { revisedFrom: `r${i - 1}` } : { rebriefedFrom: `r${i - 1}` }));
        const ids = dealHistory(runs, `r${pick % n}`).map((s) => s.id);
        expect(ids).toEqual(runs.map((r) => r.id));
      }),
    );
  });
});
