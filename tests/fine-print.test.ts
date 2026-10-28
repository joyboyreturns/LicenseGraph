import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { finePrint } from "../src/core/fine-print";
import { fixtures } from "../src/demo/fixtures";

describe("finePrint", () => {
  it("finds the clauses the rules engine does not check, quoting the licence word for word", () => {
    const text = `Licence fee: USD 90.00.
The Licensor may terminate this licence if the Licensee breaches it.
The Work may not be used to train any machine learning model.
The Licensee may not resell or redistribute the Work on its own.
Territory: Worldwide.`;
    const items = finePrint(text);
    expect(items.map((i) => i.topic)).toEqual(["termination", "ai", "resale"]);
    for (const i of items) expect(text).toContain(i.sentence);
  });

  it("says nothing about terms the engine already checks", () => {
    expect(finePrint("Territory: Worldwide.\nTerm: 24 months from the date of purchase.\nLicence fee: USD 200.00.\nThe Licensee may use the Track in commercial productions.")).toEqual([]);
  });

  it("gives every topic a place before a long licence repeats one", () => {
    const text = [..."abcde"].map((c) => `The Licensor may terminate clause ${c} at any time.`).join(" ") + " The Licensee must provide a cue sheet.";
    const topics = finePrint(text, 3).map((i) => i.topic);
    expect(topics).toEqual(["termination", "reporting", "termination"]);
  });

  it("never returns more than the limit, and only sentences from the text", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), fc.integer({ min: 0, max: 6 }), (text, limit) => {
        const items = finePrint(text, limit);
        expect(items.length).toBeLessThanOrEqual(limit);
        for (const i of items) expect(text.replace(/\r/g, "")).toContain(i.sentence);
      }),
    );
  });

  it("reads every demo licence without error", () => {
    for (const f of fixtures) expect(Array.isArray(finePrint(f.doc.text))).toBe(true);
  });
});
