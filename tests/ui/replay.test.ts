import { describe, expect, it } from "vitest";
import type { SessionView } from "@/src/app-logic/session";
import type { LedgerEvent } from "@/src/ledger/chain";
import { deriveRunState, eventDwell, phaseAt, replayDuration, replayMarkers, type RunStateInput } from "@/src/ui/lib/replay";
import { scenarioView } from "./helpers";

const inputFor = (view: SessionView, cursor: number, over: Partial<RunStateInput> = {}): RunStateInput => ({
  events: view.events,
  cursor,
  documents: view.documents,
  offers: view.candidates,
  requiredAssetIds: view.analysis!.assets.map((a) => a.assetId),
  livePhase: view.phase,
  nonCompliant: new Set(view.analysis!.evaluations.filter((e) => !e.compliant).map((e) => e.offerId)),
  ...over,
});

const ev = (seq: number, kind: LedgerEvent["kind"], payload: Record<string, unknown> = {}): LedgerEvent => ({ seq, at: "2026-10-27T00:00:00Z", kind, payload, prevHash: "", hash: `h${seq}` });

describe("deriveRunState on the game trailer", () => {
  it("starts with every document queued and the first one being read", async () => {
    const view = await scenarioView("game-trailer");
    const s = deriveRunState(inputFor(view, 0));
    expect(s.phase).toBe("created");
    expect(s.loop).toBe("idle");
    expect(Object.values(s.offers).every((o) => o === "hidden")).toBe(true);
    expect(s.docs["trailer-song-indie"]).toBe("reading");
    expect(Object.values(s.docs).filter((d) => d === "queued")).toHaveLength(7);
    expect(s.steps.read).toBe("current");
  });

  it("reveals offers as they are read", async () => {
    const view = await scenarioView("game-trailer");
    const s = deriveRunState(inputFor(view, 3));
    expect(s.loop).toBe("reading");
    expect(s.offers["offer-trailer-song-indie"]).toBe("candidate");
    expect(s.offers["offer-trailer-song-pro"]).toBe("candidate");
    expect(s.offers["offer-trailer-art-personal"]).toBe("hidden");
    expect(s.docs["trailer-art-personal"]).toBe("reading");
  });

  it("shows the first proposal being verified, then rejected", async () => {
    const view = await scenarioView("game-trailer");
    const proposed = deriveRunState(inputFor(view, 9));
    expect(proposed.loop).toBe("verifying");
    expect(proposed.round).toBe(1);
    expect(proposed.activeProposal).toEqual(["offer-trailer-song-indie", "offer-trailer-art-personal", "offer-trailer-sfx-sale"]);
    expect(proposed.offers["offer-trailer-song-indie"]).toBe("proposed");
    expect(proposed.assets.song).toBe("proposed");
    expect(proposed.steps).toMatchObject({ read: "done", propose: "done", verify: "current", approve: "todo" });

    const rejected = deriveRunState(inputFor(view, 10));
    expect(rejected.loop).toBe("rejected");
    expect(rejected.verdict).toMatchObject({ kind: "rejected", round: 1 });
    expect(rejected.offers["offer-trailer-song-indie"]).toBe("rejected");
    expect(rejected.offers["offer-trailer-song-studio"]).toBe("candidate");
    expect(rejected.notes["offer-trailer-song-indie"]!.violations.map((v) => v.rule)).toEqual(["territory", "term", "medium"]);
    expect(rejected.assets.song).toBe("rejected");
    expect(rejected.steps).toMatchObject({ propose: "current", verify: "todo" });
  });

  it("keeps earlier rejections visible in later rounds", async () => {
    const view = await scenarioView("game-trailer");
    const s = deriveRunState(inputFor(view, 11));
    expect(s.round).toBe(2);
    expect(s.offers["offer-trailer-song-indie"]).toBe("rejected");
    expect(s.offers["offer-trailer-song-studio"]).toBe("proposed");
  });

  it("ends verified with chosen, alternative and ineligible offers", async () => {
    const view = await scenarioView("game-trailer");
    const s = deriveRunState(inputFor(view, view.events.length));
    expect(s.atEnd).toBe(true);
    expect(s.phase).toBe("verified");
    expect(s.loop).toBe("verified");
    expect(s.chosen.sort()).toEqual(view.bundle!.offers.map((o) => o.id).sort());
    for (const id of s.chosen) expect(s.offers[id]).toBe("chosen");
    expect(Object.values(s.assets).every((a) => a === "covered")).toBe(true);
    expect(s.verdict).toMatchObject({ kind: "verified", round: 3, totalCents: view.bundle!.totalCents });
    expect(s.steps).toMatchObject({ read: "done", propose: "done", verify: "done", approve: "current", pay: "todo" });
    // Every offer is accounted for.
    expect(Object.values(s.offers).some((o) => o === "hidden" || o === "proposed")).toBe(false);
  });

  it("marks compliant offers that were never needed as alternatives", async () => {
    const view = await scenarioView("documentary");
    const s = deriveRunState(inputFor(view, view.events.length));
    expect(s.offers["offer-photo"]).toBe("rejected");
    expect(s.offers["offer-archive"]).toBe("chosen");
  });

  it("clamps the cursor", async () => {
    const view = await scenarioView("documentary");
    expect(deriveRunState(inputFor(view, -5)).cursor).toBe(0);
    expect(deriveRunState(inputFor(view, 999)).cursor).toBe(view.events.length);
    expect(deriveRunState(inputFor(view, Number.NaN)).cursor).toBe(view.events.length);
  });
});

describe("deriveRunState after approval and payment", () => {
  const base = [
    ev(1, "extracted", { documentId: "d", assetId: "song", offerId: "o" }),
    ev(2, "proposed", { round: 1, offerIds: ["o"] }),
    ev(3, "verified", { round: 1, offerIds: ["o"], totalCents: 100 }),
    ev(4, "approved", { approvedBy: "A" }),
    ev(5, "order_created", { orderId: "SIM-1" }),
    ev(6, "captured", { captureId: "SIMCAP-1" }),
    ev(7, "payout_created", { batchId: "b" }),
    ev(8, "payout_settled", { batchId: "b", status: "SUCCESS" }),
  ];
  const input = (events: LedgerEvent[], cursor: number, livePhase: RunStateInput["livePhase"] = "settled"): RunStateInput => ({ events, cursor, documents: [{ id: "d", assetId: "song" }], offers: [{ id: "o", assetId: "song" }], requiredAssetIds: ["song"], livePhase });

  it("walks the step rail through approve, pay, settle and passport", () => {
    expect(deriveRunState(input(base, 3)).steps).toMatchObject({ approve: "current", pay: "todo" });
    expect(deriveRunState(input(base, 4)).steps).toMatchObject({ approve: "done", pay: "current" });
    expect(deriveRunState(input(base, 5)).steps).toMatchObject({ pay: "current" });
    expect(deriveRunState(input(base, 6)).steps).toMatchObject({ pay: "done", settle: "current", passport: "todo" });
    expect(deriveRunState(input(base, 8)).steps).toMatchObject({ settle: "done", passport: "done" });
    expect(deriveRunState(input(base, 7)).phase).toBe("settled");
  });

  it("shows a failed payout as a failed settle step", () => {
    const events = [...base.slice(0, 6), ev(7, "payout_failed", { error: "boom" })];
    expect(deriveRunState(input(events, 7, "captured")).steps.settle).toBe("failed");
  });

  it("follows a live run that is still reading or proposing", () => {
    const docs = [
      { id: "d1", assetId: "song" },
      { id: "d2", assetId: "song" },
    ];
    const reading = deriveRunState({ events: [ev(1, "extracted", { documentId: "d1", assetId: "song", offerId: "o1" })], cursor: 1, documents: docs, offers: [{ id: "o1", assetId: "song" }], requiredAssetIds: ["song"], livePhase: "extracting" });
    expect(reading.docs).toEqual({ d1: "read", d2: "reading" });
    expect(reading.loop).toBe("reading");
    const revising = deriveRunState({
      events: [ev(1, "extracted", { documentId: "d1", offerId: "o1" }), ev(2, "proposed", { round: 1, offerIds: ["o1"] }), ev(3, "rejected", { round: 1, violations: [{ rule: "term", offerId: "o1", assetId: "song", message: "m" }] })],
      cursor: 3,
      documents: docs,
      offers: [{ id: "o1", assetId: "song" }],
      requiredAssetIds: ["song"],
      livePhase: "proposing",
    });
    expect(revising.loop).toBe("proposing");
    expect(revising.steps.propose).toBe("current");
  });

  it("shows a failed run", () => {
    const events = [ev(1, "extracted", { documentId: "d", offerId: "o" }), ev(2, "proposed", { round: 1, offerIds: ["o"] }), ev(3, "rejected", { round: 1, violations: [{ rule: "term", offerId: "o", message: "m" }] }), ev(4, "revised", { round: 2, offerIds: ["o"] })];
    const s = deriveRunState({ ...input(events, 4, "failed") });
    expect(s.loop).toBe("failed");
    expect(s.steps.verify).toBe("failed");
    expect(s.offers.o).toBe("rejected");
  });

  it("shows a run that could not read anything", () => {
    const s = deriveRunState({ events: [ev(1, "extraction_failed", { documentId: "d", problems: ["x"] })], cursor: 1, documents: [{ id: "d", assetId: "song" }], offers: [], requiredAssetIds: ["song"], livePhase: "failed" });
    expect(s.docs.d).toBe("unreadable");
    expect(s.steps.read).toBe("failed");
  });
});

describe("replay pacing", () => {
  it("dwells longer on verdicts than on reads", () => {
    expect(eventDwell("rejected")).toBeGreaterThan(eventDwell("extracted"));
    expect(eventDwell("verified")).toBeGreaterThan(eventDwell("proposed") - 1);
    expect(eventDwell("anything-new")).toBeGreaterThan(0);
  });
  it("keeps the game trailer replay deliberate but short", async () => {
    const view = await scenarioView("game-trailer");
    const ms = replayDuration(view.events);
    expect(ms).toBeGreaterThan(8_000);
    expect(ms).toBeLessThan(20_000);
    expect(replayDuration(view.events, 4)).toBeCloseTo(ms / 4);
  });
  it("marks verdicts on the scrubber", async () => {
    const view = await scenarioView("game-trailer");
    expect(replayMarkers(view.events).map((m) => m.kind)).toEqual(["rejected", "rejected", "verified"]);
  });
  it("derives the phase from events", () => {
    expect(phaseAt([])).toBe("created");
    expect(phaseAt([{ kind: "extracted" }])).toBe("extracting");
    expect(phaseAt([{ kind: "extracted" }, { kind: "proposed" }])).toBe("proposing");
    expect(phaseAt([{ kind: "verified" }, { kind: "approved" }, { kind: "order_created" }, { kind: "captured" }])).toBe("captured");
  });
});
