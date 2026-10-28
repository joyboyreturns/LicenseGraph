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

test("an agent can start a purchase, but only a person who takes control can approve it", async ({ page, browser }) => {
  // The agent: no cookie, so it owns nothing. It receives a claim link and nothing it can approve with.
  const agent = await browser.newContext();
  const started = await agent.request.post("/api/sessions", { data: { scenarioId: "documentary", handoff: true } });
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
