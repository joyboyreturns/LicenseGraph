import { expect, test } from "@playwright/test";
import { approveAndCreateOrder, payInSimulator, startScenario } from "./helpers";

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

  // The questions on offer fit a run with nothing to buy, and are answered from the exact checks.
  await page.getByRole("button", { name: "How much would it cost if they agree?" }).click();
  await expect(page.getByText("the cheapest compliant bundle would cost $690.00")).toBeVisible();
  await page.getByRole("button", { name: "What should I ask the licensors?" }).click();
  await expect(page.getByText("Make the licence exclusive.").last()).toBeVisible();
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

test("a purchase that came out of a negotiation carries the negotiation in its passport", async ({ page }) => {
  await page.goto("/");
  await page.locator("article", { hasText: "Exclusive theme tune" }).getByRole("button", { name: /Run this scenario/ }).click();
  await page.waitForURL(/\/run\//);
  await page.getByRole("button", { name: "Skip to result" }).first().click();
  await page.getByRole("button", { name: "Simulate the licensors agreeing" }).click();
  await page.getByRole("button", { name: "Skip to result" }).first().click();
  await expect(page.getByRole("button", { name: "Review and approve" })).toBeVisible();

  await approveAndCreateOrder(page);
  await payInSimulator(page);
  await expect(page.getByText(/Every creator has been paid/i)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "View Licence Passport" }).first().click();
  await page.waitForURL(/\/passport\//);
  await expect(page.getByText(/All 9 checks passed in this browser/)).toBeVisible({ timeout: 30_000 });
  // The first entry of the chained ledger says what this run answers, and the certificate says so.
  await expect(page.getByRole("heading", { name: "Negotiation" })).toBeVisible();
  await expect(page.getByText(/Answers an earlier run that had no compliant bundle, where 3 licensors were asked to change terms; 3 revised licences added/)).toBeVisible();
  // And what each ask did to the price: the closest offer's price when it was asked, against the licence bought.
  const outcomes = page.getByTestId("negotiation-outcomes");
  await expect(outcomes.locator("li")).toHaveCount(3);
  await expect(outcomes).toContainText("The closest offer cost $340.00; the licence bought costs $520.00 ($180.00 more)");
  await expect(outcomes).toContainText("The closest offer cost $140.00; the licence bought costs $260.00 ($120.00 more)");
  await expect(outcomes).toContainText("The closest offer cost $210.00; the licence bought costs $380.00 ($170.00 more)");
});

test("with a live model the gap panel offers a paste box for each licensor's reply, and sends exactly that licence to be checked", async ({ page }) => {
  const started = await page.request.post("/api/sessions", { data: { scenarioId: "exclusive-theme" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("failed");

  // This server runs the offline demo, so pretend it has a model and catch what the page would send.
  await page.route("**/api/config", async (route) => route.fulfill({ json: { ...(await (await route.fetch()).json()), mode: "live" } }));
  let sent: { assetId?: string; text?: string; licensor?: { name?: string } } | undefined;
  await page.route(`**/api/sessions/${id}/revise`, async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: await (await page.request.get(`/api/sessions/${id}`)).json() });
  });

  await page.goto(`/run/${id}`);
  await expect(page.getByTestId("negotiation-outlook")).toBeVisible({ timeout: 30_000 });
  const song = page.locator("details", { hasText: "They replied" }).first();
  await song.locator("summary").click();
  const check = song.getByRole("button", { name: "Check revised terms" });
  await expect(check).toBeDisabled(); // nothing pasted yet
  await song.getByRole("textbox").fill("Price: USD 520.00. Exclusive to the Licensee.");
  await check.click();
  await expect.poll(() => sent).toMatchObject({ assetId: "song", text: "Price: USD 520.00. Exclusive to the Licensee.", licensor: { name: "Tapeloop" } });
});
