import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { FileSessionRepository, deserializeSession, serializeSession } from "../src/app-logic/persistence";
import { approveSession, createSession, runPipeline, SessionStore, viewOf, type Deps } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";

const deps: Deps = { model: demoModel, proposer: greedyProposer, today: () => "2026-11-05" };
const input = () => ({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
const tmp = () => mkdtempSync(join(tmpdir(), "lg-sessions-"));

describe("serialize and deserialize", () => {
  it("round-trips a finished run, including its ledger chain", async () => {
    const s = createSession(input());
    await runPipeline(s, deps);
    approveSession(s, "Kiran");

    const back = deserializeSession(JSON.parse(JSON.stringify(serializeSession(s))));
    expect(back.phase).toBe("approved");
    expect(viewOf(back)).toEqual(viewOf(s));
    expect(back.ledger.verify()).toBe(true);
    expect(back.ledger.append("order_created", {}).seq).toBe(s.ledger.events().length + 1);
  });

  it("refuses a stored run whose ledger was edited", async () => {
    const s = createSession(input());
    await runPipeline(s, deps);
    const stored = JSON.parse(JSON.stringify(serializeSession(s)));
    stored.events[2].payload.priceCents = 1;
    expect(() => deserializeSession(stored)).toThrow(/hash chain/);
  });

  it("marks a run that was working at shutdown as interrupted", () => {
    const s = createSession(input());
    s.phase = "extracting";
    const back = deserializeSession(JSON.parse(JSON.stringify(serializeSession(s))));
    expect(back).toMatchObject({ phase: "failed", failure: expect.stringContaining("interrupted") });
  });

  it("rejects an unknown format version", () => {
    expect(() => deserializeSession({ v: 2 } as never)).toThrow(/Unknown session format/);
  });
});

describe("FileSessionRepository and SessionStore", () => {
  it("saves as the run progresses and a new store loads it back", async () => {
    const dir = tmp();
    const store = new SessionStore(50, new FileSessionRepository(dir));
    const s = store.add(createSession(input()));
    await runPipeline(s, deps);
    approveSession(s, "Kiran");

    const reloaded = new SessionStore(50, new FileSessionRepository(dir));
    expect(reloaded.get(s.id)).toBeDefined();
    expect(viewOf(reloaded.get(s.id)!)).toEqual(viewOf(s));
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("lists runs newest first", () => {
    const store = new SessionStore();
    const a = store.add({ ...createSession(input()), createdAt: "2026-11-01T00:00:00Z" });
    const b = store.add({ ...createSession(input()), createdAt: "2026-11-02T00:00:00Z" });
    expect(store.list().map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("skips corrupt and tampered files instead of failing to start", async () => {
    const dir = tmp();
    const repo = new FileSessionRepository(dir);
    const good = createSession(input());
    await runPipeline(good, deps);
    repo.save(good);
    writeFileSync(join(dir, "broken-file-1234.json"), "{not json");
    const tampered = JSON.parse(readFileSync(join(dir, `${good.id}.json`), "utf8"));
    tampered.id = "11111111-2222-3333-4444-555555555555";
    tampered.events[0].payload.documentId = "evil";
    writeFileSync(join(dir, `${tampered.id}.json`), JSON.stringify(tampered));

    expect(repo.loadAll().map((s) => s.id)).toEqual([good.id]);
  });

  it("refuses to write a file for an unsafe session id", () => {
    const repo = new FileSessionRepository(tmp());
    expect(() => repo.save({ ...createSession(input()), id: "../../etc/passwd" })).toThrow(/unsafe id/);
  });

  it("does not let a failing disk break a live run", async () => {
    const repo = { save: vi.fn(() => { throw new Error("disk full"); }), loadAll: () => [] };
    const store = new SessionStore(10, repo);
    const s = store.add(createSession(input()));
    await expect(runPipeline(s, deps)).resolves.toBeUndefined();
    expect(repo.save).toHaveBeenCalled();
  });
});
