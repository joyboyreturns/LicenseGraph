import { describe, expect, it } from "vitest";
import { bundleCanonical, sha256Hex } from "../src/core/digest";
import { Ledger, verifyChain, verifyChainAsync } from "../src/ledger/ledger";
import { bundleDigest } from "../src/payments/checkout";

const offer = (id: string, price = 100) => ({ id, assetId: "a", priceCents: price, currency: "USD", terms: { commercialUse: true, territories: ["WORLD"], termMonths: 12 }, evidence: [{ documentId: id, quote: "q" }] });

describe("shared hashing", () => {
  it("WebCrypto SHA-256 matches node:crypto for the bundle digest", async () => {
    const bundle = { offers: [offer("b", 200), offer("a")] };
    expect(await sha256Hex(bundleCanonical(bundle.offers))).toBe(bundleDigest(bundle));
  });

  it("the canonical bundle text ignores offer order", () => {
    expect(bundleCanonical([offer("b"), offer("a")])).toBe(bundleCanonical([offer("a"), offer("b")]));
  });

  it("the async ledger check agrees with the sync one, and fails on tampering", async () => {
    const l = new Ledger();
    l.append("proposed", { round: 1 });
    l.append("verified", { round: 1 });
    const events = l.events();
    expect(await verifyChainAsync(events, sha256Hex)).toBe(true);
    const bad = structuredClone(events);
    bad[0]!.payload.round = 9;
    expect(await verifyChainAsync(bad, sha256Hex)).toBe(false);
    expect(verifyChain(bad)).toBe(false);
  });
});

describe("Ledger.fromEvents and onAppend", () => {
  it("rebuilds a ledger that carries on the same chain", () => {
    const l = new Ledger();
    l.append("proposed", { round: 1 });
    const rebuilt = Ledger.fromEvents(l.events());
    const next = rebuilt.append("verified", { round: 1 });
    expect(next.seq).toBe(2);
    expect(rebuilt.verify()).toBe(true);
  });

  it("refuses stored events that fail the chain check", () => {
    const l = new Ledger();
    l.append("proposed", { round: 1 });
    const events = l.events();
    events[0]!.payload.round = 7;
    expect(() => Ledger.fromEvents(events)).toThrow(/hash chain/);
  });

  it("notifies a listener on every append", () => {
    const l = new Ledger();
    const seen: string[] = [];
    l.onAppend = (e) => seen.push(e.kind);
    l.append("proposed");
    l.append("verified");
    expect(seen).toEqual(["proposed", "verified"]);
  });
});
