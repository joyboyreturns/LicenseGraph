import { describe, expect, it } from "vitest";
import { decodeWhatIf, encodeWhatIf, type WhatIfState } from "../../src/ui/lib/whatif-link";

const brief: WhatIfState = { commercial: true, territories: ["US"], termMonths: 12, mediums: ["web"], cannotCredit: false, sublicensing: false, exclusive: false };

describe("what-if links", () => {
  it("writes nothing when nothing differs from the brief", () => {
    expect(encodeWhatIf(brief, brief)).toBeUndefined();
    expect(decodeWhatIf(undefined, brief)).toEqual(brief);
  });

  it("round-trips every kind of change, writing only the differences", () => {
    const state: WhatIfState = { commercial: false, territories: ["CA", "GB"], termMonths: 36, mediums: ["web", "print"], cannotCredit: true, sublicensing: true, exclusive: true };
    const link = encodeWhatIf(state, brief)!;
    expect(JSON.parse(link)).toEqual({ commercial: false, territories: ["CA", "GB"], termMonths: 36, mediums: ["web", "print"], cannotCredit: true, sublicensing: true, exclusive: true });
    expect(decodeWhatIf(link, brief)).toEqual(state);
    expect(JSON.parse(encodeWhatIf({ ...brief, termMonths: 24 }, brief)!)).toEqual({ termMonths: 24 });
  });

  it("treats the same places in another order as unchanged, and an emptied media list as a change", () => {
    const two = { ...brief, territories: ["US", "CA"] };
    expect(encodeWhatIf({ ...two, territories: ["CA", "US"] }, two)).toBeUndefined();
    expect(JSON.parse(encodeWhatIf({ ...brief, mediums: [] }, brief)!)).toEqual({ mediums: [] });
    expect(decodeWhatIf('{"mediums":[]}', brief).mediums).toEqual([]);
  });

  it("ignores a link that is not valid, too long, or not an object", () => {
    for (const bad of ["{nope", "[]", "null", "42", '"x"', "x".repeat(2001)]) expect(decodeWhatIf(bad, brief)).toEqual(brief);
  });

  it("keeps the brief's value for any field that is wrong, and still applies the ones that are right", () => {
    const out = decodeWhatIf(JSON.stringify({ commercial: "yes", territories: ["<script>"], termMonths: 0, mediums: ["web", "telepathy"], cannotCredit: true, exclusive: 1 }), brief);
    expect(out).toEqual({ ...brief, cannotCredit: true });
    expect(decodeWhatIf('{"termMonths":1.5}', brief).termMonths).toBe(12);
    expect(decodeWhatIf('{"termMonths":99999}', brief).termMonths).toBe(12);
    expect(decodeWhatIf('{"territories":[]}', brief).territories).toEqual(["US"]);
  });

  it("does not change the brief it was given", () => {
    const copy = structuredClone(brief);
    decodeWhatIf('{"territories":["CA"],"mediums":["print"]}', brief);
    expect(brief).toEqual(copy);
  });
});
