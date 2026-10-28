import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkMandate } from "../src/core/mandate";

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
