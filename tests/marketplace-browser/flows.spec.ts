import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { freshTotp, totp } from "../support/totp";
import { localIdentityAdmin } from "../../scripts/marketplace/keycloak-admin";
const identities = JSON.parse(readFileSync(".data-private-tests/identities.json", "utf8")) as Record<
  string,
  { email: string; password: string; id: string }
>;
async function signIn(page: Page, role: string) {
  await page.goto("/workspace");
  await page.getByRole("link", { name: "Sign in or create an account" }).click();
  await page.locator("#username").fill(identities[role]!.email);
  await page.locator("#password").fill(identities[role]!.password);
  await page.locator("#kc-login").click();
}
async function scan(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
}

test("verified sign-in, private account session, phone layout and logout", async ({ page }) => {
  await signIn(page, "buyer");
  await expect(page.getByRole("heading", { name: "Clear your next release." })).toBeVisible();
  const me = await (await page.request.get("/api/auth/me")).json();
  expect(me.user.email).toBe(identities.buyer!.email);
  expect(me.user.mfa).toBe(false);
  await scan(page);
  await page.screenshot({ path: "test-results/private-workspace-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await scan(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/private-workspace-phone.png", fullPage: true });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in or create an account" })).toBeVisible();
  expect((await (await page.request.get("/api/auth/me")).json()).user).toBeUndefined();
});

test("creator submission and staff review require an actual second factor", async ({ browser }) => {
  const asset = `local-music-${Date.now().toString(36)}`;
  // Return the staff fixture to "not yet enrolled" so enrolment is exercised on every run, not only the first.
  const admin = await localIdentityAdmin();
  for (const credential of (await admin(`/users/${identities.staff!.id}/credentials`)) as { id: string; type: string }[]) {
    if (credential.type === "otp") await admin(`/users/${identities.staff!.id}/credentials/${credential.id}`, "DELETE");
  }
  const user = (await admin(`/users/${identities.staff!.id}`)) as Record<string, unknown>;
  await admin(`/users/${identities.staff!.id}`, "PUT", { ...user, requiredActions: ["CONFIGURE_TOTP"] });

  const sellerContext = await browser.newContext(),
    staffContext = await browser.newContext();
  const seller = await sellerContext.newPage(),
    staff = await staffContext.newPage();
  await signIn(seller, "licensor");
  await seller.getByRole("button", { name: "Creator desk", exact: true }).click();
  await seller.getByLabel("Licensor name").fill("Local review creator");
  await seller.getByLabel("Identity evidence", { exact: true }).fill("Local fixture identity documentation supplied for staff review.");
  await seller.getByLabel("Rights and ownership evidence").fill("Local fixture rights documentation supplied for staff review.");
  await seller.getByLabel("I am authorized to license this work and the evidence is accurate.").check();
  await seller.getByRole("button", { name: "Submit for review", exact: true }).click();
  await seller.getByRole("button", { name: "Confirm my verified email as recipient" }).click();
  await expect(seller.getByText("Verified email confirmed.", { exact: false })).toBeVisible();
  await signIn(staff, "staff");
  await expect(staff.getByRole("heading", { name: "Mobile Authenticator Setup" })).toBeVisible();
  await staff.getByRole("link", { name: /unable to scan/i }).click();
  const key = staff.locator("#kc-totp-secret-key");
  await expect(key).toBeVisible();
  const secret = (await key.innerText()).replace(/\s/g, "");
  await staff.locator("#totp").fill(totp(secret));
  const label = staff.locator('input[name="userLabel"]');
  if (await label.isVisible()) await label.fill("Local browser fixture");
  await staff.getByRole("button", { name: /submit/i }).click();
  await expect(staff.getByRole("heading", { name: "Clear your next release." })).toBeVisible();
  await staff.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(staff, "staff");
  await staff.locator("#otp").fill(await freshTotp(secret));
  await staff.locator("#kc-login").click();
  await expect(staff.getByRole("heading", { name: "Clear your next release." })).toBeVisible();
  expect((await (await staff.request.get("/api/auth/me")).json()).user.mfa).toBe(true);
  await staff.getByRole("button", { name: "Staff review", exact: true }).click();
  const profile = staff.locator("article").filter({ has: staff.getByRole("heading", { name: "Local review creator · pending" }) });
  await profile.getByLabel("Reason", { exact: true }).fill("Local fixture identity and rights documents reviewed.");
  await profile.getByRole("button", { name: "Record decision" }).click();
  await expect(staff.getByText("Licensor reviewed completed.", { exact: true })).toBeVisible();
  await seller.reload();
  await seller.getByRole("button", { name: "Creator desk", exact: true }).click();
  await expect(seller.getByText(/Profile version \d+:/)).toContainText("approved");
  await seller.getByLabel("Asset ID", { exact: true }).fill(asset);
  await seller.getByLabel("Price in USD", { exact: true }).fill("200.00");
  await seller.getByLabel("Months, or perpetual").fill("24");
  const source = "Licence fee: USD 200.00. Commercial productions are permitted. Territory: Worldwide. Term: 24 months from purchase.";
  await seller.getByLabel("Complete licence source text").fill(source);
  await seller.getByRole("button", { name: "Add the four supporting quotations" }).click();
  for (const [field, quote] of Object.entries({
    price: "Licence fee: USD 200.00.",
    commercialUse: "Commercial productions are permitted.",
    territories: "Territory: Worldwide.",
    termMonths: "Term: 24 months from purchase.",
  }))
    await seller.getByLabel(`Exact source quotation: ${field}`, { exact: true }).fill(quote);
  await seller.getByRole("button", { name: "Submit offer for review", exact: true }).click();
  await expect(seller.getByText("Offer submitted completed.", { exact: true })).toBeVisible();
  await scan(seller);
  await staff.reload();
  await staff.getByRole("button", { name: "Staff review", exact: true }).click();
  const offer = staff.locator("article").filter({ has: staff.getByRole("heading", { name: `Offer: ${asset} · $200.00` }) });
  await offer.getByLabel("Reason", { exact: true }).fill("Price and all source quotations reviewed against the submitted terms.");
  await offer.getByRole("button", { name: "Record decision" }).click();
  await expect(staff.getByText("Offer reviewed completed.", { exact: true })).toBeVisible();
  await scan(staff);
  // A new version may state optional terms, each with its own located quotation, and a version can be withdrawn.
  await seller.reload();
  await seller.getByRole("button", { name: "Creator desk", exact: true }).click();
  await seller.getByRole("button", { name: `Create a new version of ${asset}` }).click();
  await expect(seller.getByText("Creating a new version.")).toBeVisible();
  await seller.getByLabel("Asset ID", { exact: true }).fill(asset);
  await seller.getByLabel("Price in USD", { exact: true }).fill("180.00");
  await seller.getByLabel("Months, or perpetual").fill("24");
  const richer = source + " Credit to the creator is required.";
  await seller.getByLabel("Complete licence source text").fill(richer.replace("USD 200.00", "USD 180.00"));
  await seller.getByLabel("Attribution required", { exact: true }).selectOption("yes");
  await seller.getByRole("button", { name: "Add the four supporting quotations" }).click();
  for (const [field, quote] of Object.entries({
    price: "Licence fee: USD 180.00.",
    commercialUse: "Commercial productions are permitted.",
    territories: "Territory: Worldwide.",
    termMonths: "Term: 24 months from purchase.",
  }))
    await seller.getByLabel(`Exact source quotation: ${field}`, { exact: true }).fill(quote);
  await seller.getByLabel("Exact source quotation: Attribution required", { exact: true }).fill("Credit to the creator is required.");
  await scan(seller);
  await seller.getByRole("button", { name: "Submit new version for review", exact: true }).click();
  await expect(seller.getByText("New offer version submitted completed.", { exact: true })).toBeVisible();
  const mine = seller.locator("article", { hasText: asset });
  await expect(mine.getByText("Version 2: pending")).toBeVisible();
  await seller.getByRole("button", { name: `Withdraw version 2 of ${asset}` }).click();
  await expect(seller.getByText("Offer withdrawn completed.", { exact: true })).toBeVisible();
  await expect(mine.getByText("Version 2: withdrawn")).toBeVisible();
  // The header says what this server really is.
  await expect(seller.locator(".chip").filter({ hasText: "Private workspace" }).first()).toBeVisible();
  await expect(seller.locator(".chip").filter({ hasText: "Replayed demo" })).toHaveCount(0);
  // Health reports counts only.
  const health = await (await seller.request.get("/api/marketplace/health")).json();
  expect(Object.keys(health).sort()).toEqual([
    "live_workers",
    "oldest_ready_seconds",
    "ready_jobs",
    "reasons",
    "reconcile_jobs",
    "running_jobs",
    "status",
    "unmatched_webhooks",
  ]);
  await sellerContext.close();
  await staffContext.close();
});
