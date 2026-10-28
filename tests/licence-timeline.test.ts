import { describe, expect, it } from "vitest";
import { buildTimeline } from "../src/dashboard/licence-timeline";

const row = (label: string, start: string, end: string) => ({ label, start, end });

describe("buildTimeline", () => {
  it("has nothing to draw without a dated licence", () => {
    expect(buildTimeline([], "2026-11-05")).toBeUndefined();
    expect(buildTimeline([row("a", "not a date", "2027-01-01")], "2026-11-05")).toBeUndefined();
    expect(buildTimeline([row("a", "2026-11-05", "2027-01-01")], "nope")).toBeUndefined();
  });

  it("puts bars on one axis in date order, perpetual last, running to the edge", () => {
    const t = buildTimeline([row("p", "2026-11-05", "Perpetual"), row("late", "2026-11-05", "2029-11-05"), row("early", "2026-11-05", "2027-11-05")], "2026-11-05")!;
    expect(t.bars.map((b) => b.label)).toEqual(["early", "late", "p"]);
    const [early, late, p] = t.bars;
    expect(early!.startPct).toBe(0);
    expect(early!.endPct).toBeLessThan(late!.endPct);
    expect(late!.endPct).toBeLessThan(100);
    expect(p).toMatchObject({ perpetual: true, endPct: 100, urgency: "perpetual", daysLeft: undefined });
    for (const b of t.bars) {
      expect(b.startPct).toBeGreaterThanOrEqual(0);
      expect(b.endPct).toBeLessThanOrEqual(100);
    }
  });

  it("flags a licence that ends within 90 days, or has ended, relative to today", () => {
    const t = buildTimeline([row("soon", "2026-01-01", "2026-12-01"), row("gone", "2025-01-01", "2026-10-01"), row("fine", "2026-01-01", "2028-01-01")], "2026-11-05")!;
    const by = Object.fromEntries(t.bars.map((b) => [b.label, b]));
    expect(by.soon).toMatchObject({ urgency: "soon", daysLeft: 26 });
    expect(by.gone).toMatchObject({ urgency: "ended", daysLeft: -35 });
    expect(by.fine!.urgency).toBe("later");
  });

  it("marks today and the year starts inside the axis", () => {
    const t = buildTimeline([row("a", "2026-06-01", "2029-06-01")], "2027-01-01")!;
    expect(t.todayPct).toBeGreaterThan(0);
    expect(t.ticks.map((x) => x.label)).toEqual(["2027", "2028", "2029"]);
    expect(t.ticks.every((x) => x.pct > 0 && x.pct < 100)).toBe(true);
  });

  it("keeps at least a year of axis for a short licence, and always reaches today", () => {
    const short = buildTimeline([row("a", "2026-11-05", "2026-12-05")], "2026-11-20")!;
    expect(short.bars[0]!.endPct).toBeLessThan(15);
    const stale = buildTimeline([row("a", "2026-11-05", "2026-12-05")], "2030-01-01")!;
    expect(stale.todayPct).toBeGreaterThan(90);
    expect(stale.bars[0]!.urgency).toBe("ended");
  });
});
