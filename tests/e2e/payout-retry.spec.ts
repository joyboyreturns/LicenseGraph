import { expect, test } from "@playwright/test";
import { accessibilityViolations, approveAndCreateOrder, payInSimulator, startScenario } from "./helpers";

// This file runs against a server started with --fail-first-payout.
test("when the creator payout fails the payment stays captured, and retrying completes the settlement", async ({ page }, info) => {
  await startScenario(page, "Documentary promo");
  await approveAndCreateOrder(page);
  await payInSimulator(page);

  await expect(page.getByText(/The payouts could not be sent/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/payment stays captured/i).first()).toBeVisible();
  await expect(page.getByText("FAILED").first()).toBeVisible();

  for (const theme of ["light", "dark"] as const) for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    expect(await accessibilityViolations(page), `${theme} ${width}px failed settlement`).toEqual([]);
    await page.screenshot({ path: info.outputPath(`failed-${theme}-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: /Retry payouts/ }).click();
  await expect(page.getByText(/Every creator has been paid/i)).toBeVisible({ timeout: 30_000 });
});
