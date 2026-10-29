import { expect, test } from "@playwright/test";
import { startScenario } from "./helpers";

test("the run says what each requirement costs, with the exact figures", async ({ page }) => {
  await startScenario(page, "Game launch trailer");
  const panel = page.locator("section", { hasText: "What each requirement costs you" });
  await expect(panel.getByText("The cheapest compliant bundle costs $2,170.00.")).toBeVisible();
  // Each requirement row carries one of two explanations, which tells them apart from other lists on the page.
  const row = (name: string) => panel.locator("li", { hasText: /Without it the cheapest compliant bundle|already meet this/ }).filter({ hasText: name });
  await expect(row("Media")).toContainText("+$960.00");
  await expect(row("Media")).toContainText("Without it the cheapest compliant bundle would be $1,210.00");
  await expect(row("Commercial use")).toContainText("+$440.00");
  await expect(row("Territory")).toContainText("costs nothing");
});

test("a verified run shows where it could cost less, with what to ask each licensor", async ({ page }) => {
  await startScenario(page, "Documentary promo");
  const levers = page.getByTestId("saving-levers");
  await expect(levers).toContainText("$35.00 less");
  await expect(levers).toContainText("saves $35.00");
  await expect(levers).toContainText("$45.00 instead of $80.00");
  await expect(levers).toContainText("Allow commercial use");
  const mail = levers.getByRole("link", { name: /Open in email/ });
  expect(decodeURIComponent((await mail.getAttribute("href"))!)).toContain("Allow commercial use");

  // The same figures answer the question in words, from the same checks.
  await page.getByRole("button", { name: "Where could we pay less?" }).click();
  await expect(page.getByText(/costs \$45\.00 instead of \$80\.00, saving \$35\.00/)).toBeVisible();
});

test("an agent can start a purchase, but only a person who takes control can approve it", async ({ page, browser }) => {
  // The agent: no cookie, so it owns nothing. It receives a claim link and nothing it can approve with.
  const agent = await browser.newContext();
  const started = await agent.request.post("/api/sessions", { data: { scenarioId: "documentary", handoff: true, mandate: { maxTotalCents: 30_000, currency: "USD", note: "Stay under $300", maxPerLicenceCents: 10_000, avoidLicensors: ["TypeForge Studio"] } } });
  expect(started.status()).toBe(201);
  const run = await started.json();
  expect(run.awaitingPerson).toBe(true);
  const approve = await agent.request.post(`/api/sessions/${run.id}/approve`, { data: { approvedBy: "agent" } });
  expect(approve.status()).toBe(403);

  // A person opens the link: nothing changes until they choose to take control.
  await page.goto(run.handoff.claimUrl);
  await expect(page.getByRole("heading", { name: /An agent started a purchase for you/ })).toBeVisible();
  expect((await (await agent.request.get(`/api/sessions/${run.id}`)).json()).awaitingPerson).toBe(true);

  await page.getByRole("button", { name: "Take control of this run" }).click();
  await page.waitForURL(/\/run\//);
  await page.getByRole("button", { name: "Skip to result" }).first().click();
  await expect(page.getByRole("button", { name: "Review and approve" })).toBeVisible();

  // Where the money goes, with each creator's address masked, before anyone approves.
  const preview = page.getByTestId("payout-preview");
  await expect(preview).toContainText("SoundHarbor Music");
  await expect(preview).toContainText("$200.00 to");
  await expect(preview).toContainText("•");
  await expect(preview).not.toContainText("soundharbor@licensegraph-demo.example");

  // Clauses the engine does not check are quoted for the person to read, from the licences that were bought.
  const fine = page.getByTestId("fine-print");
  await expect(fine).toContainText("Also in these licences, not checked by the rules engine");
  await expect(fine).toContainText("SoundHarbor Music");
  await expect(fine).toContainText("may terminate this licence if the Licensee breaches it.");
  await expect(fine).toContainText("train machine learning models");

  // The cap the agent was given is checked against the verified $329.00 and shown beside the approval.
  await page.getByRole("button", { name: "Review and approve" }).click();
  await expect(page.getByTestId("mandate-note")).toContainText("Over the agent's mandate by $29.00");
  await expect(page.getByTestId("mandate-note")).toContainText("Stay under $300");
  const breaches = page.getByTestId("mandate-breaches");
  await expect(breaches).toContainText("The song licence costs $200.00, above the $100.00 the agent was allowed for one licence.");
  await expect(breaches).toContainText("The font licence is from TypeForge Studio, a licensor the agent was told not to buy from.");

  // The agent still cannot, and the ledger shows the handover.
  expect((await agent.request.post(`/api/sessions/${run.id}/approve`, { data: { approvedBy: "agent" } })).status()).toBe(403);
  const after = await (await page.request.get(`/api/sessions/${run.id}`)).json();
  expect(after.awaitingPerson).toBeUndefined();
  expect(after.events.some((e: { kind: string }) => e.kind === "handed_over")).toBe(true);

  // A used link does nothing for anyone else.
  const late = await browser.newContext();
  const reuse = await late.request.post(`/api/sessions/${run.id}/claim`, { data: { token: new URL(run.handoff.claimUrl).searchParams.get("token") } });
  expect(reuse.status()).toBe(400);
  await agent.close();
  await late.close();
});
