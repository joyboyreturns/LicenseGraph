import { expect, test } from "@playwright/test";
import { accessibilityViolations, startScenario } from "./helpers";

test("a delayed refresh cannot replace a newly approved bundle with an older verified snapshot", async ({ page }) => {
  const runUrl = await startScenario(page, "Game launch trailer");
  const id = new URL(runUrl).pathname.split("/").pop();
  let release!: () => void;
  let received!: () => void;
  let delivered!: () => void;
  const held = new Promise<void>((resolve) => { received = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const finished = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route(`**/api/sessions/${id}`, async (route) => {
    const response = await route.fetch();
    received();
    await released;
    await route.fulfill({ response }).catch(() => undefined); // The fixed reader aborts this superseded request.
    delivered();
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await held;
  await page.getByLabel("Approve as").fill("Judge");
  await page.getByRole("button", { name: "Approve this bundle" }).click();
  await expect(page.getByRole("heading", { name: "Settle and pay the creators" })).toBeVisible();
  release();
  await finished;
  // Let the released fetch and React commit before checking the visible decision.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("heading", { name: "Approve the verified bundle" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Create simulated order/ })).toBeVisible();
});

test("the custom game-trailer example requires the stated distribution media", async ({ page }) => {
  await page.goto("/#describe");
  await page.getByRole("button", { name: "Game trailer", exact: true }).click();
  await page.getByRole("button", { name: "Read my brief" }).click();
  await expect(page.getByText("Found in your text")).toBeVisible();
  for (const medium of ["Web", "Social", "Broadcast TV"]) await expect(page.getByRole("checkbox", { name: medium, exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Apps & games", exact: true })).not.toBeChecked();
});

test("custom requirements reject malformed budgets before asking for licence files", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#describe");
  await page.getByRole("textbox", { name: /What are you making/ }).fill('A US commercial promo called "Release", 12 months, under $500, with a song.');
  await page.getByRole("button", { name: "Read my brief" }).click();
  const commercial = page.getByRole("radio", { name: "Commercial", exact: true });
  const personal = page.getByRole("radio", { name: "Non-commercial", exact: true });
  await commercial.focus();
  await page.keyboard.press("ArrowRight");
  await expect(personal).toBeFocused();
  await expect(personal).toBeChecked();
  await page.keyboard.press("Home");
  await expect(commercial).toBeFocused();
  await expect(commercial).toBeChecked();
  await page.getByLabel("Budget (USD, optional)").fill("1e3");
  await page.getByRole("button", { name: /Next: add licences/ }).click();
  await expect(page.locator("#describe").getByRole("alert")).toContainText("two decimal places");
  await expect(page.locator("#describe").getByRole("alert")).toBeFocused();
  await expect(page.locator("#describe").getByRole("alert")).toBeInViewport();
  expect(await accessibilityViolations(page)).toEqual([]);
  await expect(page.getByLabel("Budget (USD, optional)")).toHaveValue("1e3");
  await page.getByLabel("Budget (USD, optional)").fill("0.29");
  await page.getByLabel("Term (months)").fill("1201");
  await page.getByRole("button", { name: /Next: add licences/ }).click();
  await expect(page.locator("#describe").getByRole("alert")).toContainText("1 to 1,200");
  await page.getByLabel("Term (months)").fill("12");
  await page.getByRole("button", { name: /Next: add licences/ }).click();
  await expect(page.getByText("Prepare your evidence")).toBeVisible();
  await page.getByRole("textbox", { name: /^Licence 1 text/ }).fill("Commercial use in the US for 12 months. Price: USD 0.29.");
  let submitted!: (body: { project: { budgetCents: number; termMonths: number } }) => void;
  const submission = new Promise<{ project: { budgetCents: number; termMonths: number } }>((resolve) => { submitted = resolve; });
  await page.route("**/api/sessions", async (route) => {
    submitted(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: "Custom licences need a model. Use a recorded scenario instead." } });
  });
  await page.getByRole("button", { name: "Find a compliant bundle" }).click();
  expect((await submission).project).toMatchObject({ budgetCents: 29, termMonths: 12 });
  await expect(page.getByText("The server did not start this run.")).toBeVisible();
});
