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

  // A badge for a README, built from the passport's own re-verification.
  const passportId = new URL(page.url()).pathname.split("/").pop()!;
  const badge = await page.request.get(`/api/passports/${passportId}/badge`);
  expect(badge.headers()["content-type"]).toContain("image/svg+xml");
  expect(await badge.text()).toContain("LicenseGraph passport: 3 licences verified");
  await expect(page.getByRole("button", { name: "Copy badge for a README" })).toBeVisible();

  // Each licence's end date, counted from the day of purchase, and a calendar file with a reminder before each.
  await expect(page.getByRole("heading", { name: "When each licence ends" })).toBeVisible();
  const [calendar] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Add licence end dates to my calendar" }).click()]);
  const ics = readFileSync(await calendar.path(), "utf8");
  expect(calendar.suggestedFilename()).toMatch(/^licence-end-dates-.*\.ics$/);
  expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
  expect(ics.match(/BEGIN:VEVENT/g)?.length ?? 0).toBeGreaterThan(0);
  expect(ics).toContain("TRIGGER:-P30D");

  // The downloaded file verifies on its own; a tampered copy does not.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download JSON" }).click()]);
  const file = test.info().outputPath("passport.json");
  await download.saveAs(file);
  const passport = JSON.parse(readFileSync(file, "utf8"));
  expect(passport).toMatchObject({ version: 1, bundle: { totalCents: 217_000 }, paypal: { environment: "simulator" } });

  await page.goto("/verify");
  await page.setInputFiles('input[type="file"]', file);
  await expect(page.getByText(/All 9 checks passed in this browser/)).toBeVisible({ timeout: 30_000 });

  // Who issued it, checked in this browser against a public key: valid for the real file, not for the edited copy.
  await page.getByRole("button", { name: "Use this server’s published key" }).click();
  await expect(page.getByTestId("issuer-signature")).toContainText("Issued by the holder of this key");
  await page.getByLabel(/Issuer’s public key/).fill("A".repeat(43));
  await expect(page.getByTestId("issuer-signature")).toContainText("Not issued by that key");
  await page.getByRole("button", { name: "Use this server’s published key" }).click();
  await expect(page.getByTestId("issuer-signature")).toContainText("Issued by the holder of this key");
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Try a tampered copy" }).click();
  await expect(page.getByText(/Does not verify/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("issuer-signature")).toContainText("Not issued by that key");

  expect(errors).toEqual([]);
});
