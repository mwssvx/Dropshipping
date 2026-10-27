import { expect, test } from "@playwright/test";

// Shipping cost on the product page: what it costs to ship to the buyer's country, and when it's free.

test("product pages say what shipping costs before checkout", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Candles ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Candles/ })).toBeVisible();

  const stores: string[] = [];
  for (const [title, price] of [["Tea Light", "18.00"], ["Big Candle", "60.00"]]) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title!);
    await page.getByLabel("Price", { exact: true }).fill(price!);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    stores.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  }

  const us = await (await browser.newContext({ ...info.project.use, extraHTTPHeaders: { "x-vercel-ip-country": "US" } })).newPage();
  await us.goto(stores[0]!);
  await expect(us.locator("#shipping-cost")).toHaveText("Shipping to United States: $4.99 · Free on orders of $50.00 or more");
  await us.goto(stores[1]!);
  await expect(us.locator("#shipping-cost")).toHaveText("Free shipping to United States");
});
