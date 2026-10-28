import { expect, test } from "@playwright/test";
import { fixtures } from "../../src/demo/fixtures";
import { makePdf } from "../support/make-pdf";

test("a licence PDF is read in the browser and its text fills the licence box", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const doc = fixtures[0]!.doc;
  const lines = doc.text.split("\n").map((l) => l.trim()).filter(Boolean);

  // The PDF never leaves the browser: no request may carry it to the server.
  const uploads: string[] = [];
  page.on("request", (r) => r.method() === "POST" && /pdf/i.test(r.headers()["content-type"] ?? "") && uploads.push(r.url()));

  await page.goto("/");
  await page.getByRole("textbox", { name: /What are you making/ }).fill("A US ad for our shoe brand, 12 months, under $500, with a song.");
  await page.getByRole("button", { name: "Read my brief" }).click();
  await expect(page.getByText("Found in your text")).toBeVisible();
  await page.getByRole("button", { name: /Next: add licences/ }).click();

  const chooser = page.locator('input[type="file"]').first();
  await chooser.setInputFiles({ name: "track-licence.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf([lines])) });
  const box = page.getByRole("textbox", { name: /^Licence 1 text/ }).first();
  await expect(box).toHaveValue(/Grant: The Licensee may use the Track in commercial productions/, { timeout: 20_000 });
  await expect(page.getByText("track-licence.pdf").first()).toBeVisible();

  // A PDF that is only a picture is explained, not loaded as an empty licence.
  await chooser.setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf([[]])) });
  await expect(page.getByText(/no selectable text/)).toBeVisible({ timeout: 20_000 });
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});
