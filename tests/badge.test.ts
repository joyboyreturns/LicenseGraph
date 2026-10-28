import { describe, expect, it } from "vitest";
import { badgeSvg, badgeText } from "../src/passport/badge";

describe("passport badge", () => {
  it("says how many licences were verified, and pluralises", () => {
    expect(badgeText({ verified: true, licences: 3 }).message).toBe("3 licences verified");
    expect(badgeText({ verified: true, licences: 1 }).message).toBe("1 licence verified");
  });
  it("never says verified when the check failed or the payment was reversed", () => {
    expect(badgeText({ verified: false, licences: 3 })).toMatchObject({ message: "check failed", colour: "#b02417" });
    expect(badgeText({ verified: true, licences: 3, reversed: true })).toMatchObject({ message: "payment reversed", colour: "#b02417" });
  });
  it("is a well-formed SVG with an accessible name, and sizes both halves to their text", () => {
    const svg = badgeSvg({ verified: true, licences: 12 });
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="LicenseGraph passport: 12 licences verified"');
    const total = Number(/width="(\d+)" height="22"/.exec(svg)![1]);
    expect(total).toBeGreaterThan(150);
    expect(svg.match(/<text /g)).toHaveLength(2);
    expect(svg).not.toMatch(/NaN|undefined/);
  });
});
