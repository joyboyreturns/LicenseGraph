import { expect, test } from "@playwright/test";
import { startScenario } from "./helpers";

const SCENARIOS = [
  { title: "Documentary promo", total: "$329.00", rounds: 2 },
  { title: "Game launch trailer", total: "$2,170.00", rounds: 3 },
  { title: "Podcast network", total: "$690.00", rounds: 2 },
];

for (const s of SCENARIOS) {
  test(`${s.title}: the agent is corrected by the rules engine and ends on a verified ${s.total} bundle`, async ({ page }) => {
    await startScenario(page, s.title);
    await expect(page.getByText(new RegExp(`Verified in round ${s.rounds}`))).toBeVisible();
    await expect(page.getByText(s.total).first()).toBeVisible();
    await expect(page.locator('button[data-state="rejected"]').first()).toBeVisible();
    await expect(page.getByText(/Price-only buyer/).first()).toBeVisible();
  });
}

test("a run is replayed from recorded model output and says so", async ({ page }) => {
  await startScenario(page, "Documentary promo");
  await expect(page.getByText("Replay of recorded model output")).toBeVisible();
});

test("Exclusive theme tune: no licence can be bought, and the run says what to ask for and what a yes would cost", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("article", { hasText: "Exclusive theme tune" }).getByRole("button", { name: /Run this scenario/ }).click();
  await page.waitForURL(/\/run\//);
  await page.getByRole("button", { name: "Skip to result" }).first().click();
  await expect(page.getByRole("heading", { name: "No compliant bundle" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review and approve" })).toHaveCount(0);

  // What a yes would cost: the three closest offers at their quoted prices, against the $1,500 budget.
  const outlook = page.getByTestId("negotiation-outlook");
  await expect(outlook).toContainText("If every licensor said yes");
  await expect(outlook).toContainText("$690.00");
  await expect(outlook).toContainText("$810.00 under your budget");
  await expect(outlook).toContainText("A best case, not an offer");
  await expect(outlook.locator("li")).toHaveCount(3);

  // Each gap can be sent: copied, or opened in the email app with the subject and body filled in.
  const mail = page.getByRole("link", { name: "Open in email" }).first();
  const href = (await mail.getAttribute("href"))!;
  expect(href).toMatch(/^mailto:\?subject=Licence%20terms%20for%20the%20/);
  expect(decodeURIComponent(href)).toContain("Make the licence exclusive.");
  expect(errors).toEqual([]);
});

test("Exclusive theme tune: simulating the licensors saying yes starts a new run that verifies and can be paid, and the first run stays as it was", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator("article", { hasText: "Exclusive theme tune" }).getByRole("button", { name: /Run this scenario/ }).click();
  await page.waitForURL(/\/run\//);
  const firstUrl = page.url();
  await page.getByRole("button", { name: "Skip to result" }).first().click();
  await expect(page.getByRole("heading", { name: "No compliant bundle" })).toBeVisible();

  await page.getByRole("button", { name: "Simulate the licensors agreeing" }).click();
  await expect(page).not.toHaveURL(firstUrl);
  await page.getByRole("button", { name: "Skip to result" }).first().click();
  await expect(page.getByRole("link", { name: "Revision of an earlier run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review and approve" })).toBeVisible();
  await expect(page.getByText("$1,160.00").first()).toBeVisible();

  // The first run is still there, still without a bundle.
  await page.getByRole("link", { name: "Revision of an earlier run" }).click();
  await page.waitForURL(firstUrl);
  await expect(page.getByRole("heading", { name: "No compliant bundle" })).toBeVisible();
  expect(errors).toEqual([]);
});
