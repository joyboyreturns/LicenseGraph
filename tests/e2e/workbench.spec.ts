import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { accessibilityViolations, approveAndCreateOrder, payInSimulator } from "./helpers";

for (const theme of ["light", "dark"] as const) for (const width of [1440, 390]) {
  test(`clearance desk visual review: ${theme}, ${width}px`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    const check = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
      expect(await accessibilityViolations(page), name).toEqual([]);
      await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
      const section = name.startsWith("settlement") ? page.locator("#decide") : name.startsWith("intake") ? page.locator("#describe") : null;
      if (section) writeFileSync(info.outputPath(`${name}-region.json`), JSON.stringify(await section.boundingBox()));
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    };
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Make your next release rights-ready." })).toBeVisible();
    await check("home");
    await page.getByRole("textbox", { name: /What are you making/ }).fill("A US commercial trailer for our game, 12 months, under $3000, with music.");
    await page.getByRole("button", { name: "Read my brief" }).click();
    await expect(page.getByText("Found in your text")).toBeVisible();
    await page.locator("#describe").scrollIntoViewIfNeeded();
    await check("intake-requirements");
    await page.getByRole("button", { name: /Next: add licences/ }).click();
    const chooser = page.locator('input[type="file"]').first();
    await chooser.setInputFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("invalid") });
    await expect(page.locator("#describe").getByRole("alert")).toContainText("not a supported licence file");
    await chooser.setInputFiles({ name: "licence.txt", mimeType: "text/plain", buffer: Buffer.from("Commercial use permitted in the US for 12 months. Price: USD 250.") });
    await expect(page.getByRole("status").filter({ hasText: "characters ready for extraction" })).toBeVisible();
    await expect(page.locator("#describe").getByRole("alert")).toHaveCount(0);
    await check("intake-files");
    await page.getByRole("button", { name: "Use the recorded game trailer" }).click();
    await page.waitForURL(/\/run\//);
    await expect(page.getByRole("button", { name: "Review and approve" })).toBeVisible();
    await expect(page.locator(".desk-evidence button")).toHaveCount(3);
    const runUrl = page.url();
    const id = new URL(runUrl).pathname.split("/").pop();
    const run = await (await page.request.get(`/api/sessions/${id}`)).json();
    for (const offer of run.bundle.offers) {
      const source = offer.evidence.find((e: { field: string }) => e.field === "mediums") ?? offer.evidence.find((e: { field: string }) => e.field === "territories") ?? offer.evidence[0];
      await expect(page.locator(".desk-evidence")).toContainText(source.quote);
    }
    await check("run");
    await page.locator(".desk-evidence button").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("button", { name: "What was rejected?" })).toBeVisible();
    await page.getByRole("button", { name: "What was rejected?" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added Rule violations" })).toBeVisible();
    if (width === 390) {
      const canvas = page.locator(".ag-studio-layout-canvas");
      await expect(canvas).toBeVisible();
      expect((await canvas.boundingBox())!.width).toBeLessThanOrEqual(width);
    }
    await check("dashboard");
    await page.goto(runUrl);
    await approveAndCreateOrder(page, "Judge review");
    await check("settlement-awaiting-buyer");
    await page.getByRole("link", { name: "Open payment simulator" }).first().click();
    await expect(page.getByRole("button", { name: /Approve simulated payment/ })).toBeVisible();
    await check("checkout");
    await page.goto(runUrl);
    await payInSimulator(page);
    await expect(page.getByText(/Every creator has been paid/i)).toBeVisible();
    await check("settlement-complete");
    await page.getByRole("link", { name: "View Licence Passport" }).first().click();
    await expect(page.getByText(/All 9 checks passed in this browser/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Passport purchase summary" })).toContainText("Simulated payment");
    await check("passport");
  });
}
