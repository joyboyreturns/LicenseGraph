import { expect, test } from "@playwright/test";
import { whatIf } from "../../src/core/whatif";
import { formatMoney } from "../../src/ui/lib/format";

test("what-if re-prices the brief in the browser with the same exact numbers the core computes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const started = await page.request.post("/api/sessions", { data: { scenarioId: "documentary" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  const view = await (await page.request.get(`/api/sessions/${id}`)).json();
  const required: string[] = view.analysis.assets.map((a: { assetId: string }) => a.assetId);
  const expected = (change: object) => whatIf(view.project, change, required, view.candidates, "USD", { today: view.runDate });

  await page.goto(`/run/${id}`);
  const panel = page.getByRole("region", { name: "What if the project changed?" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const result = panel.getByRole("status");

  // Untouched: the brief as written, at the cost the run already found.
  await expect(result).toContainText("This is your brief as written.");
  await expect(result).toContainText(formatMoney(expected({}).totalCents!, "USD"));

  // Dropping commercial use is cheaper, and the panel names the swap.
  const cheaper = expected({ commercial: false });
  expect(cheaper.deltaCents).toBeLessThan(0);
  await panel.getByLabel("Commercial use").uncheck({ force: true });
  await expect(result).toContainText(formatMoney(cheaper.totalCents!, "USD"));
  await expect(result).toContainText(`${formatMoney(-cheaper.deltaCents!, "USD")} less than your brief`);
  await expect(result.locator("li").first()).toContainText("→");

  // Back to the brief.
  await panel.getByRole("button", { name: "Back to my brief" }).click();
  await expect(result).toContainText("This is your brief as written.");
  await expect(panel.getByRole("button", { name: "Back to my brief" })).toHaveCount(0);

  // Something no licence offers: the panel says which assets, and what to ask for.
  const impossible = expected({ needsSublicensing: true, requiresExclusive: true });
  expect(impossible.uncoveredAssets.length).toBeGreaterThan(0);
  await panel.getByLabel("We must sublicense").check({ force: true });
  await panel.getByLabel("We need exclusivity").check({ force: true });
  await expect(result).toContainText("No licence covers this brief");
  await expect(result).toContainText("Ask the licensor to:");
  // And what a yes to all of it would cost, from the same exact check.
  await expect(panel.getByTestId("what-if-outlook")).toContainText("If every licensor agreed to those changes at the prices they quoted, it would cost $");
  expect(errors).toEqual([]);
});

test("the term slider and the place chips change the figure, and the last place cannot be removed", async ({ page }) => {
  const started = await page.request.post("/api/sessions", { data: { scenarioId: "game-trailer" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  const view = await (await page.request.get(`/api/sessions/${id}`)).json();
  const required: string[] = view.analysis.assets.map((a: { assetId: string }) => a.assetId);

  await page.goto(`/run/${id}`);
  const panel = page.getByRole("region", { name: "What if the project changed?" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const result = panel.getByRole("status");

  const slider = panel.getByLabel("How long you need it");
  await slider.fill("60");
  const longer = whatIf(view.project, { termMonths: 60 }, required, view.candidates, "USD", { today: view.runDate });
  if (longer.totalCents !== undefined) await expect(result).toContainText(formatMoney(longer.totalCents, "USD"));
  else await expect(result).toContainText("No licence covers this brief");
  await expect(slider).toHaveValue("60");

  // The project's own place stays selected: switching off the only one does nothing.
  const only = view.project.territories as string[];
  if (only.length === 1 && only[0] !== "WORLD") {
    const chip = panel.getByRole("button", { pressed: true }).first();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
});

test("a typed sentence changes the panel the same way the controls do, and says what it understood", async ({ page }) => {
  const started = await page.request.post("/api/sessions", { data: { scenarioId: "documentary" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  const view = await (await page.request.get(`/api/sessions/${id}`)).json();
  const required: string[] = view.analysis.assets.map((a: { assetId: string }) => a.assetId);

  await page.goto(`/run/${id}`);
  const panel = page.getByRole("region", { name: "What if the project changed?" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const result = panel.getByRole("status");

  const say = panel.getByLabel("Or say it in a sentence");
  await say.fill("not commercial, for 6 months");
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByTestId("what-if-heard")).toContainText("Applied: 6 months · Non-commercial.");
  await expect(panel.getByLabel("Commercial use")).not.toBeChecked();
  await expect(panel.getByLabel("How long you need it")).toHaveValue("6");
  const expected = whatIf(view.project, { commercial: false, termMonths: 6 }, required, view.candidates, "USD", { today: view.runDate });
  if (expected.totalCents !== undefined) await expect(result).toContainText(formatMoney(expected.totalCents, "USD"));
  else await expect(result).toContainText("No licence covers this brief");

  // Gibberish changes nothing and says so.
  await say.fill("make it nicer");
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByTestId("what-if-heard")).toContainText("Nothing to change was recognised");
  await expect(panel.getByLabel("How long you need it")).toHaveValue("6");
});

test("the panel's choices live in the address, so a what-if can be shared and reopened exactly", async ({ page }) => {
  const started = await page.request.post("/api/sessions", { data: { scenarioId: "game-trailer" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");

  await page.goto(`/run/${id}`);
  const panel = page.getByRole("region", { name: "What if the project changed?" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  expect(page.url()).not.toContain("whatif=");

  await panel.getByLabel("How long you need it").fill("30");
  await panel.getByLabel("We need exclusivity").check({ force: true });
  await expect.poll(() => new URL(page.url()).searchParams.get("whatif")).toBe(JSON.stringify({ termMonths: 30, exclusive: true }));

  // Opening the same address elsewhere shows the same scenario.
  const shared = page.url();
  const other = await page.context().newPage();
  await other.goto(shared);
  const reopened = other.getByRole("region", { name: "What if the project changed?" });
  await expect(reopened.getByLabel("How long you need it")).toHaveValue("30", { timeout: 30_000 });
  await expect(reopened.getByLabel("We need exclusivity")).toBeChecked();
  await expect(reopened.getByRole("button", { name: "Back to my brief" })).toBeVisible();

  // A hand-edited, invalid link is ignored rather than trusted.
  const bad = await page.context().newPage();
  await bad.goto(`/run/${id}?whatif=${encodeURIComponent('{"termMonths":-5,"mediums":["telepathy"]}')}`);
  const badPanel = bad.getByRole("region", { name: "What if the project changed?" });
  await expect(badPanel.getByRole("button", { name: "Back to my brief" })).toHaveCount(0, { timeout: 30_000 });
  await expect(badPanel.getByLabel("How long you need it")).toHaveValue("24");

  // Going back to the brief clears the address.
  await panel.getByRole("button", { name: "Back to my brief" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("whatif")).toBeNull();
});
