import { expect, test } from "@playwright/test";

// Add to cart from product cards: one click for products with nothing to choose, and a setting to
// turn the button off.

test("a shopper adds a product to the cart from its card", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`qa-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Quick ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Quick/ })).toBeVisible();
  let store = "";
  for (const [title, stock] of [["Desk Plant", "10"], ["Gone Mug", "0"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("12.00");
    await page.getByLabel("Stock", { exact: true }).fill(stock);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }
  const all = store.replace(/\/products\/.*$/, "/collections/all");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(all);
  // Only the product that can be bought as it is gets the button.
  await expect(buyer.getByRole("button", { name: /^Add to cart/ })).toHaveCount(1);
  await buyer.getByRole("button", { name: "Add to cart: Desk Plant" }).click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.locator("main").getByText("Desk Plant").first()).toBeVisible();

  await page.goto("/admin/products");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Add to cart from product cards" }) });
  await panel.getByLabel("Show “Add to cart” on product cards").uncheck();
  await panel.getByRole("button", { name: "Save card setting" }).click();
  await expect(panel.getByText("Saved. Your store's product cards follow it now.")).toBeVisible();
  await buyer.goto(all);
  await expect(buyer.getByRole("link", { name: /Desk Plant/ })).toBeVisible();
  await expect(buyer.getByRole("button", { name: /^Add to cart/ })).toHaveCount(0);
  await buyer.context().close();
});
