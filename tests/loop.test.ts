import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { runProposeVerifyLoop, type Proposer } from "../src/agent/loop";
import type { LicenseOffer, Project } from "../src/core/types";
import { Ledger } from "../src/ledger/ledger";

const project: Project = { name: "Promo film", commercial: true, territories: ["US"], termMonths: 12, budgetCents: 50_000 };

const offer = (id: string, assetId: string, priceCents: number, terms: Partial<LicenseOffer["terms"]> = {}): LicenseOffer => ({
  id,
  assetId,
  priceCents,
  currency: "USD",
  terms: { commercialUse: true, territories: ["WORLD"], termMonths: 24, ...terms },
  evidence: [{ documentId: id, quote: "quoted terms" }],
});

const songCheapButNonCommercial = offer("song-personal", "song", 2_000, { commercialUse: false });
const songCommercial = offer("song-commercial", "song", 20_000);
const font = offer("font-std", "font", 4_900);
const candidates = [songCheapButNonCommercial, songCommercial, font];

const kinds = (l: Ledger) => l.events().map((e) => e.kind);

describe("runProposeVerifyLoop", () => {
  it("rejects the cheap non-commercial offer, revises, then accepts, all recorded", async () => {
    const ledger = new Ledger();
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["song", "font"], candidates, proposer: greedyProposer, ledger });

    expect(result.status).toBe("verified");
    expect(result.rounds).toBe(2);
    expect(result.bundle!.offers.map((o) => o.id)).toEqual(["song-commercial", "font-std"]);
    expect(result.verdict).toMatchObject({ ok: true, totalCents: 24_900 });

    expect(kinds(ledger)).toEqual(["proposed", "rejected", "revised", "verified"]);
    const rejected = ledger.events()[1]!;
    expect(rejected.payload.offerIds).toEqual(["song-personal", "font-std"]);
    expect((rejected.payload.violations as { rule: string; offerId: string }[]).map((v) => `${v.rule}:${v.offerId}`)).toEqual(["commercial-use:song-personal"]);
    expect(ledger.verify()).toBe(true);
  });

  it("accepts on the first round when the proposal is already compliant", async () => {
    const ledger = new Ledger();
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["font"], candidates, proposer: greedyProposer, ledger });
    expect(result.rounds).toBe(1);
    expect(kinds(ledger)).toEqual(["proposed", "verified"]);
  });

  it("stalls instead of looping when nothing compliant exists", async () => {
    const ledger = new Ledger();
    const proposer = { propose: vi.fn(greedyProposer.propose) };
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["song"], candidates: [songCheapButNonCommercial], proposer, ledger, maxRounds: 10 });

    expect(result.status).toBe("stalled");
    expect(result.bundle).toBeUndefined();
    expect(proposer.propose.mock.calls.length).toBeLessThan(10);
    expect(kinds(ledger)).not.toContain("verified");
  });

  it("stops at maxRounds", async () => {
    let n = 0;
    const endless: Proposer = { propose: async () => ({ offerIds: n++ % 2 ? ["song-personal"] : [] }) };
    const proposer = { propose: vi.fn(endless.propose) };
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["song"], candidates, proposer, ledger: new Ledger(), maxRounds: 1 });
    expect(result.status).toBe("exhausted");
    expect(proposer.propose).toHaveBeenCalledTimes(1);
  });

  it("never lets an invented offer id reach verification, and feeds the error back", async () => {
    const ledger = new Ledger();
    const replies = [["made-up-offer"], ["song-commercial"]];
    const seen: unknown[] = [];
    const proposer: Proposer = {
      propose: async ({ history }) => {
        seen.push(history.map((h) => h.error));
        return { offerIds: replies.shift()! };
      },
    };
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["song"], candidates, proposer, ledger });

    expect(result.status).toBe("verified");
    expect(kinds(ledger)).toEqual(["proposal_error", "revised", "verified"]);
    expect(seen[1]).toEqual(["Unknown offer ids: made-up-offer"]);
  });

  it("survives a proposer that throws", async () => {
    const ledger = new Ledger();
    let calls = 0;
    const proposer: Proposer = {
      propose: async () => {
        if (calls++ === 0) throw new Error("gateway down");
        return { offerIds: ["font-std"] };
      },
    };
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["font"], candidates, proposer, ledger });
    expect(result.status).toBe("verified");
    expect(ledger.events()[0]).toMatchObject({ kind: "proposal_error", payload: { error: "gateway down" } });
  });

  it("a verified result always has an ok verdict (the proposer cannot self-certify)", async () => {
    const liar: Proposer = { propose: async () => ({ offerIds: ["song-personal"], rationale: "This is fully compliant and verified." }) };
    const result = await runProposeVerifyLoop({ project, requiredAssetIds: ["song"], candidates, proposer: liar, ledger: new Ledger() });
    expect(result.status).not.toBe("verified");
    expect(result.bundle).toBeUndefined();
  });

  it("does not let the proposer change the history it was shown", async () => {
    const lengths: number[] = [];
    let round = 0;
    const proposer: Proposer = {
      propose: async ({ history }) => {
        lengths.push(history.length);
        history.length = 0; // a misbehaving proposer wipes what it was given
        return { offerIds: round++ === 0 ? ["song-personal"] : ["song-commercial"] };
      },
    };
    await runProposeVerifyLoop({ project, requiredAssetIds: ["song"], candidates, proposer, ledger: new Ledger() });
    expect(lengths).toEqual([0, 1]);
  });

  it("passes the expiry date through to verification", async () => {
    const expiring = offer("song-expiring", "song", 1_000, { offerValidUntil: "2026-11-01" });
    const run = (today: string) => runProposeVerifyLoop({ project, requiredAssetIds: ["song"], candidates: [expiring], proposer: greedyProposer, ledger: new Ledger(), verifyOptions: { today } });
    expect((await run("2026-11-01")).status).toBe("verified");
    expect((await run("2026-11-02")).status).not.toBe("verified");
  });
});
