import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { localIdentityAdmin } from "../../scripts/marketplace/keycloak-admin";

const identities = JSON.parse(readFileSync(".data-private-tests/identities.json", "utf8")) as Record<string, { email: string; password: string }>;
const APP = "http://localhost:3000";
const MAIL = "http://localhost:8025";

async function keycloakLogin(page: Page, email: string, password: string) {
  await page.locator("#username").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#kc-login").click();
}
const me = async (page: Page | BrowserContext) => (await (await page.request.get("/api/auth/me")).json()) as { user?: { email: string; mfa: boolean } };

/** Newest message addressed to `email`, as plain text. */
async function mailTo(email: string, after = 0) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages?: { ID: string; Created: string }[] };
    const fresh = (list.messages ?? []).filter((m) => Date.parse(m.Created) >= after);
    if (fresh.length) {
      const message = (await (await fetch(`${MAIL}/api/v1/message/${fresh[0]!.ID}`)).json()) as { Text: string };
      return message.Text;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("No message reached the local mail sink.");
}
const linkIn = (text: string) => text.match(/https?:\/\/localhost:8081\/\S+/)![0].replace(/[>)\]]+$/, "");

/** A throwaway account, removed afterwards so fixtures are never altered. */
async function temporaryUser(options: { verified: boolean }) {
  const admin = await localIdentityAdmin();
  const email = `tmp-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `Pw-${randomUUID()}`;
  await admin("/users", "POST", { username: email, email, emailVerified: options.verified, enabled: true, firstName: "Temporary", lastName: "Person", credentials: [{ type: "password", value: password, temporary: false }] });
  const found = (await admin(`/users?email=${encodeURIComponent(email)}&exact=true`)) as { id: string }[];
  return { email, password, remove: async () => { for (const user of (await admin(`/users?email=${encodeURIComponent(email)}&exact=true`)) as { id: string }[]) await admin(`/users/${user.id}`, "DELETE"); }, id: found[0]?.id };
}

test("the authorization request carries state, nonce and an S256 PKCE challenge, in an HttpOnly cookie-bound attempt", async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: APP });
  const response = await api.get("/api/auth/login?returnTo=/dashboard", { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  const location = new URL(response.headers()["location"]!);
  expect(location.origin).toBe("http://localhost:8081");
  expect(location.searchParams.get("response_type")).toBe("code");
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  expect(location.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  expect(location.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/callback`);
  expect(location.searchParams.get("scope")).toContain("openid");
  const cookie = response.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")!.value;
  expect(cookie).toMatch(/^lg_login=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).not.toContain(location.searchParams.get("state")!);
  expect(response.headers()["cache-control"]).toContain("no-store");
  await api.dispose();
});

for (const [label, returnTo, landing] of [["a protocol-relative URL", "//evil.example/x", "/workspace"], ["an absolute URL", "https://evil.example/", "/workspace"], ["a backslash trick", "/\\evil.example", "/workspace"], ["a local path", "/dashboard", "/dashboard"]] as const) {
  test(`returnTo as ${label} never leaves the application`, async ({ page }) => {
    await page.goto(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    await keycloakLogin(page, identities.buyer!.email, identities.buyer!.password);
    await page.waitForURL(/localhost:3000/);
    expect(new URL(page.url()).origin).toBe(APP);
    expect(new URL(page.url()).pathname).toBe(landing);
  });
}

test("a forged, missing or replayed callback creates no session", async ({ browser }) => {
  // Forged state/code with a genuine login attempt cookie.
  const forged = await browser.newContext({ baseURL: APP });
  const page = await forged.newPage();
  await page.goto("/api/auth/login");
  const bad = await forged.request.get("/api/auth/callback?code=forged&state=forged");
  expect(bad.status()).toBe(401);
  expect((await me(forged)).user).toBeUndefined();
  // No attempt cookie at all.
  const bare = await browser.newContext({ baseURL: APP });
  expect((await bare.request.get("/api/auth/callback?code=x&state=y")).status()).toBe(401);
  // Provider-reported errors, for example a refused consent, are a client error, not an outage.
  const refused = await forged.request.get("/api/auth/callback?error=access_denied&state=forged");
  expect(refused.status()).toBeLessThan(500);
  // A real sign-in, then the same callback URL replayed from a fresh context.
  const real = await browser.newContext({ baseURL: APP });
  const realPage = await real.newPage();
  let callback = "";
  realPage.on("request", (request) => { if (request.url().includes("/api/auth/callback")) callback = request.url(); });
  await realPage.goto("/api/auth/login");
  await keycloakLogin(realPage, identities.buyer!.email, identities.buyer!.password);
  await realPage.waitForURL(/localhost:3000\/workspace/);
  expect(callback).toContain("code=");
  const replay = await browser.newContext({ baseURL: APP });
  expect((await replay.request.get(callback)).status()).toBe(401);
  expect((await me(replay)).user).toBeUndefined();
  const sameBrowser = await real.request.get(callback);
  expect(sameBrowser.status()).toBe(401);
  await Promise.all([forged.close(), bare.close(), real.close(), replay.close()]);
});

test("sign-out revokes the server-side session and cross-origin sign-out is refused", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: APP });
  const page = await context.newPage();
  await page.goto("/api/auth/login");
  await keycloakLogin(page, identities.buyer!.email, identities.buyer!.password);
  await page.waitForURL(/localhost:3000\/workspace/);
  const cookies = await context.cookies(APP);
  const account = cookies.find((c) => c.name === "lg_account")!;
  expect(account.httpOnly).toBe(true);
  expect(account.sameSite).toBe("Lax");
  const cross = await context.request.post("/api/auth/logout", { headers: { Origin: "https://evil.example" }, maxRedirects: 0 });
  expect(cross.status()).toBe(403);
  expect((await me(context)).user?.email).toBe(identities.buyer!.email);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in or create an account" })).toBeVisible();
  // The stolen cookie value is useless after sign-out.
  const thief = await browser.newContext({ baseURL: APP });
  await thief.addCookies([{ name: "lg_account", value: account.value, url: APP }]);
  expect((await me(thief)).user).toBeUndefined();
  expect((await thief.request.get("/api/sessions")).status()).not.toBe(500);
  await Promise.all([context.close(), thief.close()]);
});

test("registration proves control of the email first, then sets a password, and only then yields an application session", async ({ page }) => {
  const email = `reg-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `Pw-${randomUUID()}`;
  const started = Date.now() - 2000;
  try {
    await page.goto("/api/auth/login");
    await page.getByRole("link", { name: /register/i }).click();
    await page.locator("#firstName").fill("Registered");
    await page.locator("#lastName").fill("Person");
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: /register/i }).click();
    await expect(page.getByText(/verify your email/i).first()).toBeVisible();
    expect(new URL(page.url()).origin).toBe("http://localhost:8081");
    expect((await me(page)).user).toBeUndefined();
    // The verification link is what grants the password step; the account has no credential before it.
    await page.goto(linkIn(await mailTo(email, started)));
    await expect(page.getByText(/change your password to activate/i)).toBeVisible();
    expect((await me(page)).user).toBeUndefined();
    await page.locator("#password-new").fill(password);
    await page.locator("#password-confirm").fill(password);
    await page.getByRole("button", { name: /submit/i }).click();
    await page.waitForURL(/localhost:3000/);
    expect((await me(page)).user?.email).toBe(email);
  } finally {
    const admin = await localIdentityAdmin();
    for (const user of (await admin(`/users?email=${encodeURIComponent(email)}&exact=true`)) as { id: string }[]) await admin(`/users/${user.id}`, "DELETE");
  }
});

test("an account whose email is unverified is held at the identity provider and never receives an application session", async ({ page }) => {
  const user = await temporaryUser({ verified: false });
  try {
    await page.goto("/api/auth/login");
    await keycloakLogin(page, user.email, user.password);
    await expect(page.getByText(/verify your email/i).first()).toBeVisible();
    expect(new URL(page.url()).origin).toBe("http://localhost:8081");
    expect((await me(page)).user).toBeUndefined();
  } finally { await user.remove(); }
});

test("password recovery sends a link through the mail sink, replaces the password and retires the old one", async ({ page, browser }) => {
  const user = await temporaryUser({ verified: true });
  const started = Date.now() - 2000;
  const next = `Pw-${randomUUID()}`;
  try {
    await page.goto("/api/auth/login");
    await page.getByRole("link", { name: /forgot password/i }).click();
    await page.locator("#username").fill(user.email);
    await page.getByRole("button", { name: /submit/i }).click();
    await page.goto(linkIn(await mailTo(user.email, started)));
    await expect(page.getByRole("heading", { name: "Update password" })).toBeVisible();
    await page.locator("#password-new").fill(next);
    await page.locator("#password-confirm").fill(next);
    await page.getByRole("button", { name: /submit/i }).click();
    await page.waitForURL(/localhost:(3000|8081)/);
    const old = await browser.newContext({ baseURL: APP });
    const oldPage = await old.newPage();
    await oldPage.goto("/api/auth/login");
    await keycloakLogin(oldPage, user.email, user.password);
    await expect(oldPage.getByText(/invalid username or password/i)).toBeVisible();
    expect((await me(old)).user).toBeUndefined();
    const fresh = await browser.newContext({ baseURL: APP });
    const freshPage = await fresh.newPage();
    await freshPage.goto("/api/auth/login");
    await keycloakLogin(freshPage, user.email, next);
    await freshPage.waitForURL(/localhost:3000/);
    expect((await me(fresh)).user?.email).toBe(user.email);
    await Promise.all([old.close(), fresh.close()]);
  } finally { await user.remove(); }
});
