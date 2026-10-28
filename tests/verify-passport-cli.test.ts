import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { greedyProposer } from "../src/agent/greedy";
import { approveSession, completePayment, createSession, runPipeline, startPayment, type Deps } from "../src/app-logic/session";
import { demoModel } from "../src/demo/mock-model";
import { sampleDocuments, sampleProject, sampleRequiredAssets } from "../src/demo/sample";
import { issuePassport } from "../src/passport/issue";
import { verifyPassport } from "../src/passport/passport";
import { formatReport } from "../src/passport/report";

const payments = {
  createOrder: vi.fn().mockResolvedValue({ id: "ORD1", status: "PAYER_ACTION_REQUIRED", approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD1" }),
  captureOrder: vi.fn().mockResolvedValue({ id: "ORD1", status: "COMPLETED", captureId: "CAP1", amount: { currency: "USD", value: "329.00" } }),
  createPayout: vi.fn().mockResolvedValue({ batchId: "BATCH1", status: "PENDING" }),
  getPayout: vi.fn(),
};
const deps: Deps = { model: demoModel, proposer: greedyProposer, payments, today: () => "2026-11-05" };

async function passport() {
  const s = createSession({ project: { ...sampleProject }, requiredAssetIds: [...sampleRequiredAssets], documents: sampleDocuments.map((d) => ({ ...d })) });
  await runPipeline(s, deps);
  approveSession(s, "Kiran");
  await startPayment(s, deps);
  await completePayment(s, deps);
  return issuePassport(s);
}

const run = (file: string) => spawnSync("node", ["--import", "tsx", "scripts/verify-passport.ts", file], { encoding: "utf8" });

describe("formatReport", () => {
  it("has one line per check and a summary", async () => {
    const result = await verifyPassport(await passport());
    const lines = formatReport(result).split("\n");
    expect(lines).toHaveLength(result.checks.length + 1);
    expect(lines.at(-1)).toBe(`All ${result.checks.length} checks passed.`);
    expect(lines.slice(0, -1).every((l) => l.startsWith("PASS  "))).toBe(true);
  });
});

describe("npm run verify:passport", () => {
  const dir = mkdtempSync(join(tmpdir(), "lg-passport-"));

  it("exits 0 for an untouched passport file and 1 for one that was edited", async () => {
    const p = await passport();
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(p));
    const ok = run(good);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/All \d+ checks passed\./);

    const bad = JSON.parse(JSON.stringify(p));
    bad.bundle.offers[0].priceCents -= 1;
    const tampered = join(dir, "tampered.json");
    writeFileSync(tampered, JSON.stringify(bad));
    const failed = run(tampered);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain("FAIL  ");
  }, 30_000);

  it("exits 2 with a plain message for something that is not a passport", () => {
    const file = join(dir, "nope.json");
    writeFileSync(file, JSON.stringify({ hello: "world" }));
    const r = run(file);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("does not look like a Licence Passport");
  }, 30_000);
});
