import { expect, test } from "@playwright/test";
import { approveAndCreateOrder, payInSimulator, startScenario } from "./helpers";

// This file runs against a server started with --fail-first-payout.
test("when the creator payout fails the payment stays captured, and retrying completes the settlement", async ({ page }) => {
  await startScenario(page, "Documentary promo");
  await approveAndCreateOrder(page);
  await payInSimulator(page);

  await expect(page.getByText(/The payouts could not be sent/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/payment stays captured/i).first()).toBeVisible();
  await expect(page.getByText("FAILED").first()).toBeVisible();

  await page.getByRole("button", { name: /Retry payouts/ }).click();
  await expect(page.getByText(/Every creator has been paid/i)).toBeVisible({ timeout: 30_000 });
});
