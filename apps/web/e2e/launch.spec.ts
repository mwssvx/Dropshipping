import { expect, test, type Page } from "@playwright/test";

// Milestone 8: the public site (landing, pricing, legal drafts), password reset, sign-in limits,
// security headers, the health check and the staff launch checklist.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the landing page leads to pricing, and the calculator picks the cheapest plan", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Start a dropshipping store for $0");
  await shot(page, "77-landing");
  await page.getByRole("link", { name: "Pricing" }).first().click();
  await expect(page.getByRole("heading", { name: "Start free. Switch when it saves you money." })).toBeVisible();

  // $2,000 and 60 orders: Free is over its 50-order limit, so Starter is cheapest.
  await expect(page.getByRole("listitem", { name: "Free: over its order limit" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Starter: $19 a month" })).toContainText("cheapest");
  // $10,000 and 200 orders: Growth.
  await page.getByLabel(/Sales a month/).fill("10000");
  await page.getByLabel(/Orders a month/).fill("200");
  await expect(page.getByRole("listitem", { name: "Growth: $49 a month" })).toContainText("cheapest");
  // $500 and 20 orders: Free's 2% is $10, under Starter's $19.
  await page.getByLabel(/Sales a month/).fill("500");
  await page.getByLabel(/Orders a month/).fill("20");
  await expect(page.getByRole("listitem", { name: "Free: $10 a month" })).toContainText("cheapest");
  await shot(page, "78-pricing");
});

test("legal pages are marked as drafts until a lawyer has checked them", async ({ page }) => {
  for (const doc of ["terms", "privacy", "acceptable-use", "merchant-agreement"]) {
    const res = await page.goto(`/legal/${doc}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("note")).toContainText("Draft for review");
  }
  await shot(page, "79-legal-draft");
  expect((await page.goto("/legal/nope"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a forgotten password can be reset from the emailed link", async ({ page }, info) => {
  const email = `m8-reset-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Store name")).toBeVisible();
  await page.context().clearCookies();

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(`If ${email} has an account`);
  await shot(page, "80-forgot-sent");

  // The development outbox stands in for the inbox.
  await page.goto("/dev/mail");
  const mail = page.getByRole("article").filter({ hasText: email }).first();
  await expect(mail).toContainText("Reset your");
  const link = (await mail.textContent())!.match(/https?:\/\/\S+\/reset\/[\w-]+/)![0];
  await page.goto(new URL(new URL(link).pathname, page.url()).toString());
  await page.getByLabel("New password").fill("a brand new password");
  await shot(page, "81-reset");
  await page.getByRole("button", { name: "Save and sign in" }).click();
  await expect(page).toHaveURL(/\/admin|\/onboarding|\/start/);

  // The old password no longer works; the new one does; the link can't be used twice.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await page.getByLabel("Password").fill("a brand new password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(new URL(new URL(link).pathname, page.url()).toString());
  await page.getByLabel("New password").fill("yet another password");
  await page.getByRole("button", { name: "Save and sign in" }).click();
  await expect(page.getByText("This link has expired or was already used.")).toBeVisible();
});

test("too many wrong passwords pause sign-in for that email", async ({ page }, info) => {
  const email = `m8-throttle-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/login");
  for (let i = 0; i < 8; i++) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(`wrong password ${i}`);
    // The error from the previous try is still on screen, so wait for this try's answer.
    const answered = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/login"));
    await page.getByRole("button", { name: "Sign in" }).click();
    await answered;
    await expect(page.getByText("That email and password don't match.")).toBeVisible();
    // React clears the password once the answer renders; typing before then would be wiped,
    // and the browser won't submit an empty required field.
    await expect(page.getByLabel("Password")).toHaveValue("");
  }
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong password 9");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Too many wrong passwords for this email.")).toBeVisible();
  await shot(page, "82-sign-in-paused");
});

test("every response carries security headers, and the health check reports the database", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["x-powered-by"]).toBeUndefined();

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true });

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /admin");
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
});

test("staff see what blocks launch on this deployment", async ({ page }, info) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`staff-m8-${info.project.name}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Store name")).toBeVisible();
  await page.goto("/staff/launch");
  await expect(page.getByRole("heading", { name: "Launch checklist" })).toBeVisible();
  // The test server runs on fake payments and the demo supplier, so launch is blocked.
  await expect(page.getByRole("status")).toContainText("blocking launch");
  await expect(page.getByRole("region", { name: "Payments" })).toContainText("Blocking");
  await expect(page.getByRole("region", { name: "Done by a person" })).toBeVisible();
  await shot(page, "83-launch-checklist");
});
