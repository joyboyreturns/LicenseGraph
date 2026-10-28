import { expect, test, type Page } from "@playwright/test";
import { accessibilityViolations } from "./helpers";

const violations = accessibilityViolations;

/** With reduced motion the replay is already at its end, and "Skip to result" is disabled; otherwise press it. */
async function toResult(page: Page) {
  const skip = page.getByRole("button", { name: "Skip to result" }).first();
  if (await skip.isEnabled()) await skip.click();
}

async function runOf(page: Page, scenarioId: string) {
  const started = await page.request.post("/api/sessions", { data: { scenarioId } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toMatch(/verified|failed/);
  return id as string;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Reduced motion, so a fade-in is never measured half-way (a blend of two colours is not what anyone sees).
    test.use({ colorScheme: scheme, reducedMotion: "reduce" });

    test("the home page and the verify page have no automated accessibility violations", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Four projects/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto("/verify");
      await expect(page.locator("main")).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto("/rules");
      await expect(page.getByRole("heading", { name: "How the rules decide" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto("/agents");
      await expect(page.getByRole("heading", { name: "Agents can shop. Only people can spend." })).toBeVisible();
      await expect(page.getByRole("region", { name: "What it finds there" }).getByText("get_purchase_status")).toBeVisible({ timeout: 20_000 });
      expect(await violations(page)).toEqual([]);
    });

    test("a verified run and a run with no bundle have none either", async ({ page }) => {
      const verified = await runOf(page, "documentary");
      await page.goto(`/run/${verified}`);
      await toResult(page);
      await expect(page.getByRole("button", { name: "Review and approve" })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      const blocked = await runOf(page, "exclusive-theme");
      await page.goto(`/run/${blocked}`);
      await toResult(page);
      await expect(page.getByTestId("negotiation-outlook")).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the portfolio dashboard, with its custom widgets drawn, has none", async ({ page }) => {
      const id = await runOf(page, "podcast");
      await page.request.post(`/api/sessions/${id}/approve`, { data: { approvedBy: "Kiran" } });
      const paid = await (await page.request.post(`/api/sessions/${id}/pay`)).json();
      await page.request.post(`/api/simulator/orders/${paid.order.id}`);
      await page.request.post(`/api/sessions/${id}/capture`);
      await page.goto("/dashboard?portfolio=1");
      await expect(page.getByRole("img", { name: /^Where the/ })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("list", { name: "Licence end dates" })).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.goto(`/passport/${id}/receipt/song`);
      await expect(page.getByRole("heading", { name: /song licence/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.goto(`/passport/${id}`);
      await expect(page.getByRole("link", { name: /Song: Creator receipt/ })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}
