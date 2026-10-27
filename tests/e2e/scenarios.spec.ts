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
