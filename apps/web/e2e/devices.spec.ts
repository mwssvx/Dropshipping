import { expect, test, type Page } from "@playwright/test";

// Where you're signed in: every browser and the merchant app, with sign out for one or all others.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the account page lists where you're signed in and signs other devices out", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const email = `dev-${id}@example.com`;
  const password = "correct horse battery";
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Dev ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Dev/ })).toBeVisible();

  // A second browser, and the merchant app twice.
  const other = await (await browser.newContext({ ...info.project.use })).newPage();
  await other.goto("/login");
  await other.getByLabel("Email").fill(email);
  await other.getByLabel("Password").fill(password);
  await other.getByRole("button", { name: "Sign in" }).click();
  await expect(other).toHaveURL(/\/admin$/);
  const appTokens: string[] = [];
  for (let i = 0; i < 2; i++) {
    const r = await page.request.post("/api/app/v1/auth/login", { data: { email, password } });
    appTokens.push((await r.json()).token);
  }
  const me = (token: string) => page.request.get("/api/app/v1/me", { headers: { authorization: `Bearer ${token}` } });

  await page.goto("/admin/account");
  const list = page.getByRole("list", { name: "Signed-in devices" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list.getByRole("listitem").first().getByText("This device")).toBeVisible();
  await expect(list.getByRole("listitem", { name: "Merchant app" })).toHaveCount(2);
  await shot(page, "399-signed-in-devices");

  // One app sign-in signed out.
  await list.getByRole("button", { name: "Sign out Merchant app" }).first().click();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  const statuses = await Promise.all(appTokens.map(async (t) => (await me(t)).status()));
  expect(statuses.sort()).toEqual([200, 401]);

  // Everywhere else: the other browser and the other app sign-in.
  await page.getByRole("button", { name: "Sign out everywhere else" }).click();
  await expect(page.getByText("Signed out of 2 other devices.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  for (const t of appTokens) expect((await me(t)).status()).toBe(401);
  await other.goto("/admin");
  await expect(other).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
});
