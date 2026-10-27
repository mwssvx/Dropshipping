import { expect, test } from "@playwright/test";

// Age check: a product with a minimum age says so on the store, the buyer ticks "I'm old enough"
// at checkout, and the order tells the merchant to check ID.

test("a buyer confirms their age for a restricted product", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`age-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Cellar ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Cellar/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Red Wine");
  await page.getByLabel("Price", { exact: true }).fill("18.00");
  await page.getByLabel("Stock", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  await page.getByLabel("Buyers must be at least").selectOption("21");
  await page.getByRole("button", { name: "Save age check" }).click();
  await expect(page.getByText("Buyers must confirm they're 21 or older.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByText("Only for buyers 21 or older")).toBeVisible();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  const confirm = buyer.getByRole("checkbox", { name: "I confirm I'm 21 or older" });
  await expect(confirm).not.toBeChecked();
  await expect(buyer.getByText("Have your ID ready when it arrives.", { exact: false })).toBeVisible();
  await confirm.check();
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByText("Buyer confirmed 21+")).toBeVisible();
});
