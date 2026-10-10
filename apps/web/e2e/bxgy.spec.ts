import { expect, test, type Page } from "@playwright/test";

// Buy X get Y: "Buy 2, get 1 free" applies by itself, shows on the product page, and the cart
// says when one more item would be free.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("an automatic buy 2, get 1 free offer", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bx-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/marketing");
  await page.getByLabel("Code", { exact: true }).fill("buy2get1");
  await page.getByLabel("Type").selectOption({ label: "Buy X, get Y" });
  await expect(page.getByLabel("Buyer buys")).toHaveValue("2");
  await expect(page.getByLabel("Buyer gets")).toHaveValue("1");
  await expect(page.getByLabel("Percent off what they get")).toHaveValue("100");
  await expect(page.getByLabel(/Apply it automatically/)).toBeChecked();
  await shot(page, "231-bxgy-form");
  await page.getByRole("button", { name: "Create offer" }).click();
  await expect(page.getByText("Code created. Buyers can use it now.")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "BUY2GET1" });
  await expect(row).toContainText("Buy 2, get 1 free");
  await expect(row).toContainText("automatic, no code needed");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByRole("list", { name: "Offers" })).toContainText("Buy 2, get 1 free");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  const quantity = buyer.getByLabel("Quantity");
  await quantity.fill("2");
  await buyer.getByRole("button", { name: "Update" }).click();
  await expect(buyer.getByText("Buy 2, get 1 free: Add 1 more and it's free.")).toBeVisible();
  await quantity.fill("3");
  await buyer.getByRole("button", { name: "Update" }).click();
  await expect(buyer.getByText("Discount (Buy 2, get 1 free)")).toBeVisible();
  await expect(buyer.getByText(/Add 1 more and it's free/)).toHaveCount(0);
  await shot(buyer, "232-bxgy-cart");

  // It carries through to the order.
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByText("Discount (BUY2GET1)")).toBeVisible();
});
