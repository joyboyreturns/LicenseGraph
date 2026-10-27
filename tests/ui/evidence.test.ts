import { describe, expect, it } from "vitest";
import { findQuote, segmentText } from "@/src/ui/lib/evidence";

const join = (segs: { text: string }[]) => segs.map((s) => s.text).join("");

describe("segmentText", () => {
  const text = "Price: USD 200.00.\nTerritory: Worldwide.\nTerm: 24 months.";

  it("returns the whole text as one plain segment when there is nothing to highlight", () => {
    const r = segmentText(text, []);
    expect(r.segments).toEqual([{ start: 0, end: text.length, text, marks: [] }]);
    expect(r.unplaced).toEqual([]);
  });

  it("highlights ranges by offset and keeps every character exactly once", () => {
    const start = text.indexOf("Territory");
    const end = start + "Territory: Worldwide.".length;
    const r = segmentText(text, [{ id: "territories", start, end, quote: "Territory: Worldwide." }]);
    expect(join(r.segments)).toBe(text);
    expect(r.segments.find((s) => s.marks.includes("territories"))?.text).toBe("Territory: Worldwide.");
    expect(r.placed[0]).toMatchObject({ via: "offsets" });
  });

  it("splits overlapping ranges into shared and unshared parts", () => {
    const r = segmentText("abcdefghij", [
      { id: "a", start: 1, end: 6 },
      { id: "b", start: 4, end: 9 },
    ]);
    expect(r.segments.map((s) => [s.text, s.marks])).toEqual([
      ["a", []],
      ["bcd", ["a"]],
      ["ef", ["a", "b"]],
      ["ghi", ["b"]],
      ["j", []],
    ]);
  });

  it("handles identical and nested ranges", () => {
    const r = segmentText("hello world", [
      { id: "x", start: 0, end: 11 },
      { id: "y", start: 0, end: 11 },
      { id: "z", start: 6, end: 11 },
    ]);
    expect(r.segments.map((s) => [s.text, s.marks])).toEqual([
      ["hello ", ["x", "y"]],
      ["world", ["x", "y", "z"]],
    ]);
  });

  it("clamps out-of-range offsets and drops empty or inverted ones", () => {
    const r = segmentText("short", [
      { id: "over", start: 2, end: 999 },
      { id: "neg", start: -10, end: 1 },
      { id: "empty", start: 3, end: 3 },
      { id: "inverted", start: 4, end: 1 },
      { id: "nan", start: Number.NaN, end: 2 },
    ]);
    expect(join(r.segments)).toBe("short");
    expect(r.segments.map((s) => [s.text, s.marks])).toEqual([
      ["s", ["neg"]],
      ["h", []],
      ["ort", ["over"]],
    ]);
    expect(r.unplaced.sort()).toEqual(["empty", "inverted", "nan"]);
  });

  it("finds a quote by searching when offsets are missing or wrong", () => {
    const r = segmentText(text, [
      { id: "missing", quote: "Term: 24 months." },
      { id: "wrong", start: 0, end: 5, quote: "Territory: Worldwide." },
      { id: "nowhere", quote: "Not in the text" },
    ]);
    expect(r.placed.find((p) => p.id === "missing")).toMatchObject({ via: "search", start: text.indexOf("Term:") });
    expect(r.placed.find((p) => p.id === "wrong")).toMatchObject({ via: "search", start: text.indexOf("Territory") });
    expect(r.unplaced).toEqual(["nowhere"]);
    expect(join(r.segments)).toBe(text);
  });

  it("matches quotes across line wraps", () => {
    const wrapped = "may use the clip in commercial\nworks distributed in the United States\nand Canada only.";
    const found = findQuote(wrapped, "works distributed in the United States and Canada only.");
    expect(found).not.toBeNull();
    expect(wrapped.slice(found!.start, found!.end)).toBe("works distributed in the United States\nand Canada only.");
    expect(findQuote(wrapped, "   ")).toBeNull();
  });

  it("copes with empty text and very long text", () => {
    expect(segmentText("", [{ id: "a", start: 0, end: 4 }]).segments).toEqual([]);
    const long = "x".repeat(100_000) + "NEEDLE" + "y".repeat(100_000);
    const r = segmentText(long, [{ id: "n", quote: "NEEDLE" }]);
    expect(r.segments).toHaveLength(3);
    expect(r.segments[1]).toMatchObject({ text: "NEEDLE", marks: ["n"] });
  });
});
