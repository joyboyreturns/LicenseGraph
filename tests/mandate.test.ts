import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkMandate, mandateBreaches } from "../src/core/mandate";

const cap = { maxTotalCents: 80_000, currency: "USD" };

describe("checkMandate", () => {
  it("is within the cap with the margin left, including exactly at the cap", () => {
    expect(checkMandate(cap, { totalCents: 69_000, currency: "USD" })).toEqual({ status: "within", marginCents: 11_000 });
    expect(checkMandate(cap, { totalCents: 80_000, currency: "USD" })).toEqual({ status: "within", marginCents: 0 });
  });

  it("is over the cap by exactly the difference", () => {
    expect(checkMandate(cap, { totalCents: 80_001, currency: "USD" })).toEqual({ status: "over", overByCents: 1 });
  });

  it("never compares across currencies", () => {
    expect(checkMandate(cap, { totalCents: 1, currency: "EUR" })).toEqual({ status: "other_currency" });
  });

  it("margin and overage always add back to the difference", () => {
    fc.assert(
      fc.property(fc.nat(10_000_000), fc.nat(10_000_000), (max, total) => {
        const r = checkMandate({ maxTotalCents: max, currency: "USD" }, { totalCents: total, currency: "USD" });
        if (r.status === "within") expect(max - r.marginCents).toBe(total);
        else if (r.status === "over") expect(max + r.overByCents).toBe(total);
        else throw new Error("unexpected");
      }),
    );
  });
});

describe("mandateBreaches", () => {
  const licences = [
    { assetId: "song", priceCents: 20_000, currency: "USD", licensor: "SoundHarbor Music" },
    { assetId: "image", priceCents: 4_500, currency: "USD", licensor: "PixelLeaf Images" },
    { assetId: "font", priceCents: 4_900, currency: "USD" },
  ];

  it("has nothing to say when the mandate sets no licence-level limits", () => {
    expect(mandateBreaches(cap, licences)).toEqual([]);
  });

  it("names a licence above the per-licence cap, and is fine exactly at it", () => {
    const r = mandateBreaches({ ...cap, maxPerLicenceCents: 10_000 }, licences);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "per-licence-cap", assetId: "song" });
    expect(r[0]!.detail).toContain("$200.00");
    expect(r[0]!.detail).toContain("$100.00");
    expect(mandateBreaches({ ...cap, maxPerLicenceCents: 20_000 }, licences)).toEqual([]);
  });

  it("names a licensor the person asked not to buy from, ignoring case and spacing", () => {
    const r = mandateBreaches({ ...cap, avoidLicensors: ["  soundharbor   MUSIC "] }, licences);
    expect(r).toEqual([{ kind: "avoided-licensor", assetId: "song", detail: expect.stringContaining("SoundHarbor Music") }]);
    expect(mandateBreaches({ ...cap, avoidLicensors: ["Somebody Else", ""] }, licences)).toEqual([]);
  });

  it("does not compare a per-licence cap across currencies, and reports every breach once", () => {
    expect(mandateBreaches({ ...cap, maxPerLicenceCents: 1 }, [{ assetId: "song", priceCents: 999_999, currency: "EUR" }])).toEqual([]);
    const both = mandateBreaches({ ...cap, maxPerLicenceCents: 10_000, avoidLicensors: ["SoundHarbor Music"] }, licences);
    expect(both.map((b) => b.kind)).toEqual(["per-licence-cap", "avoided-licensor"]);
  });
});
