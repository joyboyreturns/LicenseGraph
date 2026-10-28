import { describe, expect, it } from "vitest";
import { addMonths, isIsoDate } from "../src/core/dates";
import { verifyBundle } from "../src/core/rules";
import type { LicenseOffer, Project } from "../src/core/types";
import { createSession } from "../src/app-logic/session";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";

const project: Project = { name: "Promo", commercial: true, territories: ["US"], termMonths: 12 };
const offer: LicenseOffer = { id: "o", assetId: "song", priceCents: 100, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24 }, evidence: [{ documentId: "d", quote: "q" }] };

describe("verification input integrity", () => {
  it.each([-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid cents %s before the payment gate", (priceCents) => {
    const result = verifyBundle(project, ["song"], { offers: [{ ...offer, priceCents }] });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.rule)).toContain("amount");
  });

  it("rejects unsafe totals even when each line is individually safe", () => {
    const result = verifyBundle(project, ["song", "font"], { offers: [{ ...offer, priceCents: Number.MAX_SAFE_INTEGER }, { ...offer, id: "b", assetId: "font" }] });
    expect(result.violations.map((v) => v.rule)).toContain("amount");
  });

  it.each([NaN, Infinity, -1, 1.5])("does not interpret invalid budgets as unlimited: %s", (budgetCents) => {
    expect(verifyBundle({ ...project, budgetCents }, ["song"], { offers: [offer] }).ok).toBe(false);
  });

  it("rejects extra assets and duplicate offer ids", () => {
    expect(verifyBundle(project, ["song"], { offers: [offer, { ...offer, assetId: "font" }] }).violations.map((v) => v.rule)).toContain("coverage");
  });

  it("does not ignore a fixed end date when only a month duration was requested", () => {
    const bundle = { offers: [{ ...offer, terms: { ...offer.terms, fixedEndDate: "2026-12-31" } }] };
    expect(verifyBundle(project, ["song"], bundle, { today: "2026-10-28" }).violations.map((v) => v.rule)).toContain("term");
    expect(verifyBundle(project, ["song"], bundle).ok).toBe(false);
    expect(verifyBundle(project, ["song"], { offers: [{ ...bundle.offers[0]!, terms: { ...offer.terms, fixedEndDate: "2027-10-28" } }] }, { today: "2026-10-28" }).ok).toBe(true);
  });

  it("requires both the requested duration and explicit end date to be covered", () => {
    expect(verifyBundle({ ...project, endDate: "2029-01-01" }, ["song"], { offers: [offer] }, { today: "2026-10-28" }).ok).toBe(false);
    expect(verifyBundle({ ...project, endDate: "2026-11-01" }, ["song"], { offers: [{ ...offer, terms: { ...offer.terms, fixedEndDate: "2026-12-31" } }] }, { today: "2026-10-28" }).ok).toBe(false);
  });

  it.each(["JPY", "HUF", "TWD", "XYZ"])("refuses currencies that cannot be safely settled as cents: %s", (currency) => {
    expect(verifyBundle(project, ["song"], { offers: [{ ...offer, currency }] }).violations.map((v) => v.rule)).toContain("currency");
  });

  it("never compares a USD budget with euro prices as though the units were the same", () => {
    const bundle = { offers: [{ ...offer, currency: "EUR" }] };
    expect(verifyBundle({ ...project, budgetCents: 1000 }, ["song"], bundle).ok).toBe(false);
    expect(verifyBundle({ ...project, budgetCents: 1000, currency: "EUR" }, ["song"], bundle).ok).toBe(true);
  });

  it.each(["2026-02-29", "2026-13-01", "2026-04-31", "2026-1-01"])("rejects invalid calendar date %s", (date) => {
    expect(isIsoDate(date)).toBe(false);
    expect(verifyBundle(project, ["song"], { offers: [{ ...offer, terms: { ...offer.terms, offerValidUntil: date } }] }, { today: "2026-10-28" }).ok).toBe(false);
  });

  it("uses calendar months at month and leap-year boundaries", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2028-02-29", 12)).toBe("2029-02-28");
  });

  it("snapshots caller input and rejects malformed project budgets and dates", () => {
    const input = { project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: structuredClone(sampleDocuments) };
    const session = createSession(input);
    input.project.name = "Changed outside the session";
    input.documents[0]!.text = "Replaced outside the session";
    expect(session.input.project.name).toBe(sampleProject.name);
    expect(session.input.documents[0]!.text).toBe(sampleDocuments[0]!.text);
    expect(() => createSession({ ...input, project: { ...input.project, budgetCents: NaN } })).toThrow(/Budget/);
    expect(() => createSession({ ...input, project: { ...input.project, endDate: "2026-02-29" } })).toThrow(/calendar/);
  });
});
