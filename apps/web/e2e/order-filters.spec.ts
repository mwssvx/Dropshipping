import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// Order list filters: every order with one product (from the product's page), shipping to one
// country, or placed recently.

async function buy(browser: Browser, info: TestInfo, product: string, email: string, uk: boolean) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill(uk ? "Zoe Hart" : "Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill(uk ? "10 Downing St" : "1 Main St");
  await buyer.getByLabel("City").fill(uk ? "London" : "Austin");
  if (!uk) await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill(uk ? "SW1A 1AA" : "78701");
  if (uk) await buyer.getByLabel("Country").selectOption("GB");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: /^Thank you/ })).toBeVisible();
  await buyer.context().close();
}

test("a merchant finds every order with a product, and orders to one country", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`of-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Finder ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Finder/ })).toBeVisible();
  const stores: string[] = [];
  const admin: string[] = [];
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    stores.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
    admin.push(page.url());
  }
  await buy(browser, info, stores[0]!, `ada-${id}@example.com`, false);
  await buy(browser, info, stores[1]!, `zoe-${id}@example.com`, true);

  const rows = page.getByRole("table").getByRole("row").filter({ hasText: /@example\.com|Lovelace|Hart/ });
  // From the lamp's page to its orders.
  await page.goto(admin[0]!);
  await page.getByRole("link", { name: "See orders" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?product=/);
  await expect(page.getByText("Orders with Sunset Projection Lamp")).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(/Ada Lovelace|ada-/);
  await page.getByRole("link", { name: "Show all orders" }).click();
  await expect(rows).toHaveCount(2);

  await page.getByLabel("Ship-to country").selectOption("GB");
  await expect(page).toHaveURL(/country=GB/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(/Zoe Hart|zoe-/);
  const csv = await (await page.request.get("/admin/orders/export.csv?country=GB")).text();
  expect(csv).toContain(`zoe-${id}@example.com`);
  expect(csv).not.toContain(`ada-${id}@example.com`);

  // Both orders are from today, so a recent range keeps them; the download follows it.
  await page.getByLabel("Placed in").selectOption("7");
  await expect(page).toHaveURL(/placed=7/);
  await expect(page).toHaveURL(/country=GB/);
  await expect(rows).toHaveCount(1);
  await expect(page.locator('form[aria-label="Download orders"] input[name="placed"]')).toHaveValue("7");
  const recent = await (await page.request.get("/admin/orders/export.csv?placed=7")).text();
  expect(recent).toContain(`zoe-${id}@example.com`);
  expect(recent).toContain(`ada-${id}@example.com`);
});
