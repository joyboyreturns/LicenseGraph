import { expect, test } from "@playwright/test";

test("a plain-English brief is read, and assumptions are shown separately from what the text said", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/What are you making/).fill("A US ad for our shoe brand, 12 months, under $500, with a song and a font.");
  await page.getByRole("button", { name: "Read my brief" }).click();
  await expect(page.getByText("Found in your text")).toBeVisible();
  await expect(page.getByText(/Territory: US/)).toBeVisible();
  await expect(page.getByText(/Term: 12 months/)).toBeVisible();
});

test("custom licences explain honestly that they need a live model when the server runs offline", async ({ request }) => {
  const res = await request.post("/api/sessions", { data: { project: { name: "Mine", commercial: true, territories: ["US"], termMonths: 12 }, requiredAssetIds: ["song"], documents: [{ id: "d", assetId: "song", text: "Some licence text" }] } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/need a model/);
});

test("the main pages load without errors, and unknown pages and runs are handled", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|AG Studio|\*\*\*/.test(m.text()) && errors.push(m.text()));
  for (const path of ["/", "/verify", "/dashboard"]) {
    await page.goto(path);
    await expect(page.locator("main, #main").first()).toBeVisible();
  }
  await page.goto("/run/00000000-0000-0000-0000-000000000000");
  await expect(page.getByText(/This run does not exist on this server/i)).toBeVisible();
  await page.goto("/definitely-not-a-page");
  await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the page has no horizontal scroll on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/verify"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
