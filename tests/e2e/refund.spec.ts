import { expect, test } from "@playwright/test";
import { approveAndCreateOrder, payInSimulator, startScenario } from "./helpers";

// This file runs against its own server started with --fail-first-payout.
test("when no creator could be paid the buyer can be refunded in full, and no passport is issued", async ({ page }) => {
  const runUrl = await startScenario(page, "Documentary promo");
  const id = runUrl.split("/run/")[1]!;
  await approveAndCreateOrder(page);
  await payInSimulator(page);

  await expect(page.getByText(/The payouts could not be sent/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/No creator was paid, so the buyer can be refunded in full/)).toBeVisible();

  await page.getByRole("button", { name: "Refund the buyer" }).click();
  await expect(page.getByText(/The buyer was refunded \$329\.00/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/no Licence Passport is issued/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry payouts/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /View (Licence )?[Pp]assport/ })).toHaveCount(0);

  // The record agrees: the ledger says so, a passport is refused, and the refund cannot be repeated.
  const view = await (await page.request.get(`/api/sessions/${id}`)).json();
  expect(view.phase).toBe("refunded");
  expect(view.chainValid).toBe(true);
  expect(view.events.at(-1)).toMatchObject({ kind: "refunded", payload: { amount: { value: "329.00" } } });
  expect((await page.request.get(`/api/passports/${id}`)).status()).toBe(409);
  expect((await page.request.post(`/api/sessions/${id}/refund`)).status()).toBe(400);
});
