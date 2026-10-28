import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { accessibilityViolations, approveAndCreateOrder, payInSimulator, startScenario } from "./helpers";

test("a scenario goes from licences to a verified, paid and independently checkable passport", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await startScenario(page, "Game launch trailer");

  // The loop is visible: three rounds, rejections by the rules engine, then a verified bundle.
  await expect(page.getByText(/Verified in round 3/)).toBeVisible();
  await expect(page.locator('button[data-state="rejected"]').first()).toBeVisible();
  await expect(page.locator('button[data-state="chosen"]')).toHaveCount(3);
  await expect(page.getByText("Rules engine (code, not AI)").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Independent cost check" })).toBeVisible();
  await expect(page.getByText(/Optimality checked independently/)).toBeVisible();

  // Trying to complete the payment before the buyer approves gives a clear message, not a crash.
  await approveAndCreateOrder(page);
  await page.getByRole("button", { name: /approved it, complete payment/ }).click();
  await expect(page.getByText(/buyer has not approved/i).first()).toBeVisible();

  await payInSimulator(page);
  await expect(page.getByText(/Every creator has been paid/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("2170.00 USD captured").first()).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]); // the paid run, with the payout table

  // The passport re-checks itself in the browser.
  await page.getByRole("link", { name: "View Licence Passport" }).first().click();
  await page.waitForURL(/\/passport\//);
  await expect(page.getByText(/All 9 checks passed in this browser/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("SIMULATED").first()).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  // The downloaded file verifies on its own; a tampered copy does not.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download JSON" }).click()]);
  const file = test.info().outputPath("passport.json");
  await download.saveAs(file);
  const passport = JSON.parse(readFileSync(file, "utf8"));
  expect(passport).toMatchObject({ version: 1, bundle: { totalCents: 217_000 }, paypal: { environment: "simulator" } });

  await page.goto("/verify");
  await page.setInputFiles('input[type="file"]', file);
  await expect(page.getByText(/All 9 checks passed in this browser/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Try a tampered copy" }).click();
  await expect(page.getByText(/Does not verify/)).toBeVisible({ timeout: 30_000 });

  expect(errors).toEqual([]);
});
