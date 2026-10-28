import { describe, expect, it } from "vitest";
import { readChange } from "@/src/intake/change";

const read = (text: string, current = { territories: ["US"], mediums: ["web"] }) => readChange(text, current).change;

describe("readChange: only what the sentence says", () => {
  it("returns nothing for text that states no change", () => {
    expect(readChange("hmm, what would happen?").change).toEqual({});
    expect(readChange("").described).toEqual([]);
  });

  it("reads places, term and media and leaves the rest alone", () => {
    expect(read("only in Canada for 6 months")).toEqual({ territories: ["CA"], termMonths: 6 });
    expect(read("worldwide on broadcast for 2 years")).toEqual({ territories: ["WORLD"], termMonths: 24, mediums: ["broadcast"] });
    expect(read("forever")).toEqual({ termMonths: 1200 });
  });

  it("replaces places and media unless the text adds to them", () => {
    expect(read("in Canada").territories).toEqual(["CA"]);
    expect(read("also in Canada").territories).toEqual(["US", "CA"]);
    expect(read("add broadcast").mediums).toEqual(["web", "broadcast"]);
    expect(read("also worldwide").territories).toEqual(["WORLD"]);
  });

  it("clears the media for 'any media'", () => {
    expect(read("any media")).toEqual({ mediums: [] });
  });

  it("reads commercial and non-commercial use", () => {
    expect(read("make it non-commercial")).toEqual({ commercial: false });
    expect(read("it becomes a paid advert campaign").commercial).toBe(true);
  });

  it("reads negations as the opposite of requiring the thing", () => {
    expect(read("no exclusivity")).toEqual({ requiresExclusive: false });
    expect(read("non-exclusive is fine")).toEqual({ requiresExclusive: false });
    expect(read("we need exclusivity")).toEqual({ requiresExclusive: true });
    expect(read("we don't need to sublicense")).toEqual({ needsSublicensing: false });
    expect(read("we must sublicense to clients")).toEqual({ needsSublicensing: true });
    expect(read("we can't credit the creators")).toEqual({ canCredit: false });
    expect(read("we can credit them")).toEqual({ canCredit: true });
  });

  it("describes every part it read, in words", () => {
    const { described } = readChange("worldwide for 18 months, no exclusivity, can't credit");
    expect(described).toEqual(["Worldwide", "18 months", "Cannot credit creators", "No exclusivity"]);
  });
});
