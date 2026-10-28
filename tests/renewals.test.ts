import { describe, expect, it } from "vitest";
import { buildIcs, licenceEnd, licenceEnds } from "../src/core/renewals";
import type { LicenseOffer, LicenseTerms } from "../src/core/types";

const offer = (id: string, terms: Partial<LicenseTerms>): LicenseOffer => ({ id, assetId: "song", priceCents: 100, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 12, ...terms }, evidence: [{ documentId: "d", quote: "q" }] });

describe("licenceEnd", () => {
  it("adds the term to the day of purchase, clamping to the end of a short month", () => {
    expect(licenceEnd(offer("a", { termMonths: 24 }), "2026-11-05").endsOn).toBe("2028-11-05");
    expect(licenceEnd(offer("a", { termMonths: 1 }), "2026-01-31").endsOn).toBe("2026-02-28");
  });
  it("takes the earlier of the term and a fixed end date", () => {
    expect(licenceEnd(offer("a", { termMonths: 24, fixedEndDate: "2027-06-30" }), "2026-11-05").endsOn).toBe("2027-06-30");
    expect(licenceEnd(offer("a", { termMonths: 6, fixedEndDate: "2030-01-01" }), "2026-11-05").endsOn).toBe("2027-05-05");
  });
  it("a perpetual licence has no end, unless it carries a fixed one", () => {
    expect(licenceEnd(offer("a", { termMonths: "perpetual" }), "2026-11-05")).toMatchObject({ endsOn: undefined, perpetual: true });
    expect(licenceEnd(offer("a", { termMonths: "perpetual", fixedEndDate: "2029-01-01" }), "2026-11-05")).toMatchObject({ endsOn: "2029-01-01", perpetual: false });
  });
  it("orders soonest first and perpetual last", () => {
    const ends = licenceEnds([offer("p", { termMonths: "perpetual" }), offer("b", { termMonths: 36 }), offer("a", { termMonths: 12 })], "2026-11-05");
    expect(ends.map((e) => e.offerId)).toEqual(["a", "b", "p"]);
  });
});

describe("buildIcs", () => {
  const items = [{ uid: "o1", label: "Tape, loop; \"Ltd\"", endsOn: "2027-12-31" }];
  const ics = buildIcs("Neon, Drift", items, "20261105T000000Z");

  it("is a valid-looking calendar with CRLF lines and an alarm", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").filter((l) => l.startsWith("BEGIN:")).length).toBe(ics.split("\r\n").filter((l) => l.startsWith("END:")).length);
    expect(ics).toContain("DTSTART;VALUE=DATE:20271231\r\nDTEND;VALUE=DATE:20280101\r\n");
    expect(ics).toContain("TRIGGER:-P30D");
  });
  it("escapes commas, semicolons and backslashes", () => {
    expect(ics).toContain("SUMMARY:Licence ends: Tape\\, loop\; \"Ltd\"");
  });
  it("is the same file for the same input", () => {
    expect(buildIcs("Neon, Drift", items, "20261105T000000Z")).toBe(ics);
  });
  it("folds long lines at 75 octets without splitting a character", () => {
    const long = buildIcs("P", [{ uid: "x", label: "é".repeat(120), endsOn: "2027-01-01" }], "20261105T000000Z");
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, "")).toContain("é".repeat(120));
  });
  it("has no event for no licence", () => {
    expect(buildIcs("P", [], "20261105T000000Z")).not.toContain("VEVENT");
  });
});
