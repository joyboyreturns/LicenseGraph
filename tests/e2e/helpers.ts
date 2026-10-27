import { expect, type Page } from "@playwright/test";

/** Start a built-in scenario from the home page and land on its run page. */
export async function startScenario(page: Page, title: string) {
  await page.goto("/");
  await page.locator("article", { hasText: title }).getByRole("button", { name: /Run this scenario/ }).click();
  await page.waitForURL(/\/run\//);
  await page.getByRole("button", { name: "Skip to result" }).first().click();
  await expect(page.getByRole("button", { name: "Review and approve" })).toBeVisible();
  return page.url();
}

/** Approve the verified bundle and create the simulated order. */
export async function approveAndCreateOrder(page: Page, approver = "Ada Lovelace") {
  await page.getByRole("button", { name: "Review and approve" }).click();
  await page.getByLabel("Approve as").fill(approver);
  await page.getByRole("button", { name: "Approve this bundle" }).click();
  await page.getByRole("button", { name: /Create simulated order/ }).click();
  await expect(page.getByRole("link", { name: "Open payment simulator" }).first()).toBeVisible();
}

/** Open the simulated checkout, approve as the buyer, and wait to be sent back to the run. */
export async function payInSimulator(page: Page) {
  await page.getByRole("link", { name: "Open payment simulator" }).first().click();
  await page.waitForURL(/simulator\/checkout/);
  await page.getByRole("button", { name: /Approve simulated payment/ }).click();
  await page.waitForURL(/\/run\//);
}
