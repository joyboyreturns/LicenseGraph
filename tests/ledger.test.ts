import { describe, expect, it } from "vitest";
import { Ledger, verifyChain } from "../src/ledger/ledger";

const clock = () => {
  let t = Date.UTC(2026, 10, 3, 10, 0, 0);
  return () => new Date((t += 1000));
};

describe("Ledger", () => {
  it("numbers events, timestamps them and links each to the previous hash", () => {
    const ledger = new Ledger(clock());
    const a = ledger.append("proposed", { round: 1 });
    const b = ledger.append("rejected", { round: 1 });

    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(a.at).toBe("2026-11-03T10:00:01.000Z");
    expect(a.prevHash).toBe("0".repeat(64));
    expect(b.prevHash).toBe(a.hash);
    expect(ledger.verify()).toBe(true);
  });

  it("is deterministic: same events and clock give the same hashes", () => {
    const run = () => {
      const l = new Ledger(clock());
      l.append("proposed", { x: 1 });
      return l.append("verified", { y: 2 }).hash;
    };
    expect(run()).toBe(run());
  });

  it("detects an edited payload, a removed event and a reordering", () => {
    const l = new Ledger(clock());
    l.append("proposed", { total: 100 });
    l.append("verified", { total: 100 });
    l.append("approved", { by: "owner" });
    const events = l.events();

    const edited = structuredClone(events);
    edited[1]!.payload.total = 1;
    expect(verifyChain(edited)).toBe(false);
    expect(verifyChain([events[0]!, events[2]!])).toBe(false);
    expect(verifyChain([events[1]!, events[0]!, events[2]!])).toBe(false);
    expect(verifyChain(events)).toBe(true);
  });

  it("hands out copies, so recorded events cannot be edited in place", () => {
    const l = new Ledger(clock());
    const payload = { round: 1 };
    const ev = l.append("proposed", payload);
    payload.round = 99;
    ev.payload.round = 98;
    l.events()[0]!.payload.round = 97;

    expect(l.events()[0]!.payload).toEqual({ round: 1 });
    expect(l.verify()).toBe(true);
  });
});
