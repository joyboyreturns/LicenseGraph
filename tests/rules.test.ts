import { describe, expect, it } from "vitest";
import { verifyBundle } from "../src/core/rules";
import type { LicenseOffer, Project } from "../src/core/types";

const project: Project = { name: "Promo film", commercial: true, territories: ["US", "IN"], termMonths: 12, budgetCents: 50_000 };

const offer = (over: Partial<LicenseOffer> = {}): LicenseOffer => ({
  id: "o1",
  assetId: "song",
  priceCents: 20_000,
  currency: "USD",
  terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24 },
  evidence: [{ documentId: "d1", quote: "Licensed worldwide for commercial use for 24 months." }],
  ...over,
});

describe("verifyBundle", () => {
  it("accepts a compliant bundle", () => {
    const v = verifyBundle(project, ["song"], { offers: [offer()] });
    expect(v).toEqual({ ok: true, totalCents: 20_000, violations: [] });
  });

  it("rejects non-commercial licences for a commercial project", () => {
    const v = verifyBundle(project, ["song"], { offers: [offer({ terms: { commercialUse: false, territories: ["WORLD"], termMonths: 24 } })] });
    expect(v.violations.map((x) => x.rule)).toEqual(["commercial-use"]);
  });

  it("rejects territories that do not cover the project", () => {
    const v = verifyBundle(project, ["song"], { offers: [offer({ terms: { commercialUse: true, territories: ["US"], termMonths: 24 } })] });
    expect(v.violations.map((x) => x.rule)).toEqual(["territory"]);
  });

  it("rejects terms shorter than the project, accepts perpetual", () => {
    const short = verifyBundle(project, ["song"], { offers: [offer({ terms: { commercialUse: true, territories: ["WORLD"], termMonths: 6 } })] });
    expect(short.violations.map((x) => x.rule)).toEqual(["term"]);
    const perpetual = verifyBundle(project, ["song"], { offers: [offer({ terms: { commercialUse: true, territories: ["WORLD"], termMonths: "perpetual" } })] });
    expect(perpetual.ok).toBe(true);
  });

  it("flags missing coverage and duplicates", () => {
    const v = verifyBundle(project, ["song", "font"], { offers: [offer(), offer({ id: "o2" })] });
    expect(v.violations.map((x) => x.rule).sort()).toEqual(["coverage", "duplicate-asset"]);
  });

  it("requires evidence on every offer", () => {
    const v = verifyBundle(project, ["song"], { offers: [offer({ evidence: [] })] });
    expect(v.violations.map((x) => x.rule)).toEqual(["evidence"]);
  });

  it("enforces budget and single currency", () => {
    const v = verifyBundle(project, ["song", "font"], {
      offers: [offer({ priceCents: 40_000 }), offer({ id: "o2", assetId: "font", priceCents: 20_000, currency: "EUR" })],
    });
    expect(v.violations.map((x) => x.rule).sort()).toEqual(["budget", "currency"]);
  });
});
