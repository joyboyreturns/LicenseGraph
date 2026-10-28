import { expect, test } from "@playwright/test";
import { startScenario } from "./helpers";

test("a plain-English brief is read, and assumptions are shown separately from what the text said", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  // Accessibility roles exclude the hidden server-rendered streaming copy during hydration.
  const brief = page.getByRole("textbox", { name: /What are you making/ });
  await expect(brief).toHaveCount(1);
  await brief.fill("A US ad for our shoe brand, 12 months, under $500, with a song and a font.");
  await page.getByRole("button", { name: "Read my brief" }).click();
  await expect(page.getByText("Found in your text")).toBeVisible();
  await expect(page.getByText(/Territory: US/)).toBeVisible();
  expect(errors).toEqual([]);
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
  for (const path of ["/", "/verify", "/agents", "/dashboard"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("the mobile run shows the independent cost proof without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startScenario(page, "Game launch trailer");
  const proof = page.getByRole("heading", { name: "Independent cost check" }).locator("..");
  await expect(proof.getByText(/Optimality checked independently/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await proof.screenshot({ path: test.info().outputPath("mobile-cost-proof.png") });
});

test("the no-bundle run, with its outlook and licensor messages, and the passport fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  const started = await page.request.post("/api/sessions", { data: { scenarioId: "exclusive-theme" } });
  const { id } = await started.json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("failed");
  await page.goto(`/run/${id}`);
  await expect(page.getByTestId("negotiation-outlook")).toBeVisible({ timeout: 30_000 });
  expect(await overflow()).toBeLessThanOrEqual(0);

  // A paid run's passport, with the licence end dates and the negotiation section.
  const revised = await (await page.request.post(`/api/sessions/${id}/revise`, { data: { simulate: true } })).json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${revised.id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  await page.request.post(`/api/sessions/${revised.id}/approve`, { data: { approvedBy: "Kiran" } });
  const paid = await (await page.request.post(`/api/sessions/${revised.id}/pay`)).json();
  await page.request.post(`/api/simulator/orders/${paid.order.id}`);
  await page.request.post(`/api/sessions/${revised.id}/capture`);
  await page.goto(`/passport/${revised.id}`);
  await expect(page.getByRole("heading", { name: "When each licence ends" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Negotiation" })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test("a shared link carries a preview card: the page names an image, and the image is a real PNG", async ({ page, request }) => {
  await page.goto("/");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toMatch(/\/opengraph-image/);
  const res = await request.get(new URL(og!).pathname + new URL(og!).search);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect((await res.body()).subarray(0, 4).toString("hex")).toBe("89504e47");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
});

test("a shared passport link has its own preview card, and an unpaid or unknown run gets the plain one", async ({ page, request }) => {
  const { id } = await (await request.post("/api/sessions", { data: { scenarioId: "podcast" } })).json();
  await expect.poll(async () => (await (await request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  const card = async (runId: string) => {
    const res = await request.get(`/passport/${runId}/opengraph-image`);
    return { status: res.status(), type: res.headers()["content-type"], png: (await res.body()).subarray(0, 4).toString("hex"), bytes: (await res.body()).length };
  };
  const plain = await card(id); // verified but not paid: no passport yet
  expect(plain).toMatchObject({ status: 200, type: "image/png", png: "89504e47" });

  await request.post(`/api/sessions/${id}/approve`, { data: { approvedBy: "Kiran" } });
  const paid = await (await request.post(`/api/sessions/${id}/pay`)).json();
  await request.post(`/api/simulator/orders/${paid.order.id}`);
  await request.post(`/api/sessions/${id}/capture`);
  const real = await card(id);
  expect(real).toMatchObject({ status: 200, type: "image/png", png: "89504e47" });
  expect(real.bytes).not.toBe(plain.bytes); // it drew this purchase, not the plain card

  expect(await card("no-such-run")).toMatchObject({ status: 200, type: "image/png" });
  await page.goto(`/passport/${id}`);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", new RegExp(`/passport/${id}/opengraph-image`));
});

test("pages and API answers carry the security headers, and the app still works with them", async ({ request, page }) => {
  for (const path of ["/", "/api/health", "/passport/none"]) {
    const h = (await request.get(path)).headers();
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The AG Studio trial notice is also logged as an error until a licence key is set; only policy refusals matter here.
  page.on("console", (m) => m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text()) && errors.push(m.text()));
  const { id } = await (await page.request.post("/api/sessions", { data: { scenarioId: "documentary" } })).json();
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  await page.goto("/dashboard?portfolio=1");
  await expect(page.getByRole("table", { name: /How many times each rule rejected each asset/ })).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("each licence has a creator receipt: the price, the payout, the terms and the sentences they came from", async ({ page, request }) => {
  const { id } = await (await request.post("/api/sessions", { data: { scenarioId: "podcast" } })).json();
  await expect.poll(async () => (await (await request.get(`/api/sessions/${id}`)).json()).phase, { timeout: 30_000 }).toBe("verified");
  await request.post(`/api/sessions/${id}/approve`, { data: { approvedBy: "Kiran" } });
  const paid = await (await request.post(`/api/sessions/${id}/pay`)).json();
  await request.post(`/api/simulator/orders/${paid.order.id}`);
  await request.post(`/api/sessions/${id}/capture`);

  // From the passport, through the link on the licence's row.
  await page.goto(`/passport/${id}`);
  await page.getByRole("link", { name: /Song: Creator receipt/ }).click();
  await page.waitForURL(/\/receipt\/song$/);
  await expect(page.getByRole("heading", { name: /Tapeloop: song licence/ })).toBeVisible();
  await expect(page.getByText("$340.00").first()).toBeVisible();
  await expect(page.getByTestId("receipt-payout")).toContainText("$340.00");
  await expect(page.getByTestId("receipt-payout")).toContainText("through PayPal Payouts (payment simulator, no money moved)");
  await expect(page.getByText("Approved by Kiran")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The sentences these terms come from" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Verify the passport" })).toHaveAttribute("href", `/passport/${id}`);

  // A licence this purchase does not have says so plainly instead of drawing an empty receipt.
  await page.goto(`/passport/${id}/receipt/no-such-asset`);
  await expect(page.getByText(/no licence for "no-such-asset"/)).toBeVisible();
});

test("the rules page explains every rule, and says silence does not pass", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "How the rules work" }).click();
  await page.waitForURL(/\/rules$/);
  await expect(page.getByRole("heading", { name: "How the rules decide" })).toBeVisible();
  const table = page.getByRole("table", { name: "The rules every licence offer is checked against" });
  await expect(table.locator("tbody tr")).toHaveCount(11);
  await expect(table.getByRole("row", { name: /Media/ })).toContainText("A licence that does not say which media it covers is not assumed to cover them");
  await expect(page.getByRole("heading", { name: "Checked on the bundle as a whole" })).toBeVisible();
});

test("the tour lists seven steps in order, and its buttons start the scenario they name", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Take the tour" }).click();
  await page.waitForURL(/\/tour$/);
  const steps = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
  await expect(steps).toHaveCount(7);
  await expect(steps.first().getByRole("heading")).toContainText("Watch a model be corrected by code");
  await expect(page.getByRole("link", { name: "Open the Verify page" })).toHaveAttribute("href", "/verify");

  await page.getByRole("button", { name: "Start the exclusive theme tune" }).click();
  await page.waitForURL(/\/run\//);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  expect((await (await page.request.get(`/api/sessions/${id}`)).json()).meta.scenarioId).toBe("exclusive-theme");
});

test("the app can be installed: a web manifest names it and points at an icon that exists", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "LicenseGraph", start_url: "/", display: "standalone" });
  expect((await request.get(manifest.icons[0].src)).status()).toBe(200);
});
