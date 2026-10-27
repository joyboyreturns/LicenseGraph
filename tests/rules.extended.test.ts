import { describe, expect, it } from "vitest";
import { verifyBundle } from "../src/core/rules";
import type { LicenseOffer, LicenseTerms, Project } from "../src/core/types";

const base: Project = { name: "Promo film", commercial: true, territories: ["US"], termMonths: 12 };

const offerWith = (terms: Partial<LicenseTerms> = {}): LicenseOffer => ({
  id: "o1",
  assetId: "song",
  priceCents: 10_000,
  currency: "USD",
  terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24, ...terms },
  evidence: [{ documentId: "d1", quote: "Worldwide commercial use, 24 months." }],
});

const rules = (project: Project, terms: Partial<LicenseTerms>, today?: string) =>
  verifyBundle(project, ["song"], { offers: [offerWith(terms)] }, { today }).violations.map((v) => v.rule);

describe("a constraint the project does not declare is not checked", () => {
  it("accepts an offer that is silent on everything", () => {
    expect(rules(base, {})).toEqual([]);
  });
});

describe("medium", () => {
  const project = { ...base, mediums: ["web", "broadcast"] };
  it("passes when the licence covers every medium, or ALL", () => {
    expect(rules(project, { mediums: ["web", "broadcast", "print"] })).toEqual([]);
    expect(rules(project, { mediums: "ALL" })).toEqual([]);
  });
  it("fails when a medium is missing", () => {
    const v = verifyBundle(project, ["song"], { offers: [offerWith({ mediums: ["web"] })] }).violations;
    expect(v.map((x) => x.rule)).toEqual(["medium"]);
    expect(v[0]!.message).toMatch(/broadcast/);
  });
  it("fails when the licence does not state its media", () => {
    expect(rules(project, {})).toEqual(["medium"]);
  });
});

describe("attribution", () => {
  const project = { ...base, canCredit: false };
  it("passes when the licence needs no credit", () => expect(rules(project, { attributionRequired: false })).toEqual([]));
  it("fails when credit is required", () => expect(rules(project, { attributionRequired: true })).toEqual(["attribution"]));
  it("fails when the licence is silent", () => expect(rules(project, {})).toEqual(["attribution"]));
  it("does not matter when the project can credit", () => expect(rules({ ...base, canCredit: true }, { attributionRequired: true })).toEqual([]));
});

describe("sublicensing", () => {
  const project = { ...base, needsSublicensing: true };
  it("passes when granted", () => expect(rules(project, { sublicensing: true })).toEqual([]));
  it("fails when denied or silent", () => {
    expect(rules(project, { sublicensing: false })).toEqual(["sublicensing"]);
    expect(rules(project, {})).toEqual(["sublicensing"]);
  });
});

describe("exclusivity", () => {
  const project = { ...base, requiresExclusive: true };
  it("passes for an exclusive licence", () => expect(rules(project, { exclusive: true })).toEqual([]));
  it("fails for a non-exclusive or silent licence", () => {
    expect(rules(project, { exclusive: false })).toEqual(["exclusivity"]);
    expect(rules(project, {})).toEqual(["exclusivity"]);
  });
});

describe("fixed end date", () => {
  const project = { ...base, endDate: "2027-06-30" };
  it("passes when the licence outlasts the project (same day counts)", () => {
    expect(rules(project, { fixedEndDate: "2027-12-31" })).toEqual([]);
    expect(rules(project, { fixedEndDate: "2027-06-30" })).toEqual([]);
  });
  it("fails when the licence ends first", () => expect(rules(project, { fixedEndDate: "2027-06-29" })).toEqual(["term"]));
});

describe("offer expiry", () => {
  it("passes on or before the last valid day", () => {
    expect(rules(base, { offerValidUntil: "2026-11-30" }, "2026-11-30")).toEqual([]);
    expect(rules(base, { offerValidUntil: "2026-11-30" }, "2026-11-01")).toEqual([]);
  });
  it("fails after the last valid day", () => expect(rules(base, { offerValidUntil: "2026-11-30" }, "2026-12-01")).toEqual(["expiry"]));
  it("fails safe when it cannot check, because no date was supplied", () => expect(rules(base, { offerValidUntil: "2026-11-30" })).toEqual(["expiry"]));
});

describe("several new constraints at once", () => {
  it("reports each violation separately", () => {
    const project: Project = { ...base, mediums: ["film"], needsSublicensing: true, requiresExclusive: true };
    expect(rules(project, { mediums: ["web"], sublicensing: false, exclusive: false }).sort()).toEqual(["exclusivity", "medium", "sublicensing"]);
  });
});
