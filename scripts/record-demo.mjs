#!/usr/bin/env node
// Records the judge journey from docs/DEMO_SCRIPT.md as a captioned 1920x1080 video, with no voice-over.
//   npm run demo -- --port 3400 --fresh        (in one terminal: offline replay + payment simulator)
//   node scripts/record-demo.mjs http://localhost:3400 demo-video
// Writes demo-video/licensegraph-demo.webm (YouTube accepts WebM). The payment shown is the labelled simulator;
// the captions say so. Nothing here contacts a model or PayPal.
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3400";
const out = process.argv[3] ?? "demo-video";
const started = Date.now();
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: base,
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: out, size: { width: 1920, height: 1080 } },
});
await context.addInitScript(() => {
  // A caption bar and a visible cursor, re-created on every page the journey visits.
  const install = () => {
    if (document.getElementById("lg-cap")) return;
    const style = document.createElement("style");
    style.textContent = `
      #lg-cap{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:1560px;z-index:2147483647;pointer-events:none;
        background:rgba(9,13,24,.92);color:#fff;font:600 34px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px 30px;border-radius:14px;
        text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.45);transition:opacity .25s;opacity:0}
      #lg-cap.on{opacity:1}
      #lg-dot{position:fixed;width:26px;height:26px;border-radius:50%;background:rgba(255,196,0,.85);border:3px solid #fff;z-index:2147483647;
        pointer-events:none;transform:translate(-50%,-50%);left:-100px;top:-100px;box-shadow:0 0 0 2px rgba(0,0,0,.4)}`;
    document.documentElement.append(style);
    const cap = document.createElement("div");
    cap.id = "lg-cap";
    const dot = document.createElement("div");
    dot.id = "lg-dot";
    document.documentElement.append(cap, dot);
    addEventListener("mousemove", (e) => {
      dot.style.left = e.clientX + "px";
      dot.style.top = e.clientY + "px";
    });
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install);
  else install();
  window.__caption = (text) => {
    install();
    const cap = document.getElementById("lg-cap");
    cap.textContent = text || "";
    cap.classList.toggle("on", Boolean(text));
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));

const wait = (ms) => page.waitForTimeout(ms);
const say = async (text, hold = 0) => {
  await page.evaluate((t) => window.__caption?.(t), text).catch(() => {});
  if (hold) await wait(hold);
};
async function click(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await wait(350);
  await locator.click();
}

// 1. Home
await page.goto("/");
await say("LicenseGraph. AI proposes. Code verifies. People approve.", 6500);
await say("Every project ends up with licences nobody has time to read, and the creators get paid late.", 6500);

// 2. Start the game trailer scenario
await say("A game trailer: worldwide, 24 months, web, social and broadcast, under $3,000. Eight licences for three assets.", 0);
await click(page.locator("article", { hasText: "Game launch trailer" }).getByRole("button", { name: /Run this scenario/ }));
await page.waitForURL(/\/run\//);
const runUrl = page.url();
await wait(5500);
await say("This scenario replays recorded model output. The agent reads the licences; a rules engine written as plain code checks every proposal.", 0);
const fast = page.getByRole("radio", { name: /4/ }).first();
if (await fast.isVisible().catch(() => false)) await fast.click().catch(() => {});
await wait(7000);
await say("Invalid licences are rejected with the rule that failed. The agent revises. Three rounds later, the bundle is verified.", 0);
const verified = page.getByText(/Verified in round 3/);
const done = await verified.waitFor({ timeout: 40000 }).then(() => true, () => false);
if (!done) await page.getByRole("button", { name: "Skip to result" }).first().click();
await verified.waitFor({ timeout: 30000 });
await wait(3000);

// 3. Evidence
const rejected = page.locator('button[data-state="rejected"]').first();
if (await rejected.isVisible().catch(() => false)) {
  await say("A rejected licence, with the rule that failed and the sentence it came from.", 0);
  await click(rejected);
  await wait(5500);
  await page.keyboard.press("Escape");
  await wait(600);
}
await say("Every term links to the exact quoted sentence in the licence text, so a person can inspect it.", 0);
const evidence = page.locator(".desk-evidence button").first();
if (await evidence.isVisible().catch(() => false)) {
  await click(evidence);
  await wait(7000);
  await page.keyboard.press("Escape");
  await wait(600);
}

// 4. Independent cost check
const check = page.getByRole("heading", { name: "Independent cost check" });
await check.scrollIntoViewIfNeeded();
await say("A price-only buyer would pick licences they cannot use. A separate check proves $2,170 is the lowest compliant cost across all 18 possible bundles.", 10000);

// 5. Approval and payment (simulator)
await click(page.getByRole("button", { name: "Review and approve" }));
await say("A person approves exactly this bundle: its prices, terms and evidence. Changing any of them voids the approval.", 0);
const name = page.getByLabel("Approve as");
await name.click();
await page.keyboard.type("Ada Lovelace", { delay: 90 });
await wait(1500);
await click(page.getByRole("button", { name: "Approve this bundle" }));
await wait(2500);
await say("Payment here is the labelled simulator: no money moves. The same flow runs on PayPal Sandbox.", 0);
await click(page.getByRole("button", { name: /Create simulated order/ }));
const open = page.getByRole("link", { name: "Open payment simulator" }).first();
await open.waitFor();
await wait(2500);
await click(open);
await page.waitForURL(/simulator\/checkout/);
await wait(2500);
await click(page.getByRole("button", { name: /Approve simulated payment/ }));
await page.waitForURL(/\/run\//);
await page.getByText(/Every creator has been paid/i).waitFor({ timeout: 30000 });
await say("Captured exactly $2,170, then one payout per creator, each checked against its own receipt.", 8500);

// 6. Passport
await click(page.getByRole("link", { name: "View Licence Passport" }).first());
await page.waitForURL(/\/passport\//);
await say("The Licence Passport. Anyone can check it in their own browser: the hash chain, the rules, the source quotes and the payment.", 0);
await page.getByText(/All 9 checks passed in this browser/).waitFor({ timeout: 30000 });
await wait(9500);

// 7. Dashboard
const id = new URL(runUrl).pathname.split("/").pop();
await page.goto(`/dashboard?session=${id}`);
await page.getByRole("table", { name: /How many times each rule rejected each asset/ }).waitFor({ timeout: 30000 });
await say("The AG Studio dashboard brings licences, rules and payments together.", 5000);
const ask = page.getByRole("button", { name: "What was rejected?" });
if (await ask.isVisible().catch(() => false)) {
  await click(ask);
  await wait(4500);
}
await say("AI proposes. Code verifies. People approve.", 5000);
await say("", 500);

const seconds = Math.round((Date.now() - started) / 1000);
await context.close();
await browser.close();
const file = readdirSync(out).find((f) => f.endsWith(".webm"));
if (file) renameSync(join(out, file), join(out, "licensegraph-demo.webm"));
console.log(`Recorded ${out}/licensegraph-demo.webm in about ${seconds} seconds.`);
if (seconds > 175) console.error("Warning: longer than the 3 minute limit; shorten the holds.");
