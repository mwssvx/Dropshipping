import { expect, test } from "@playwright/test";

// Blocked buyers: the merchant blocks the buyer of an order, and that email can't check out again
// until they're unblocked.

test("a blocked buyer can't check out again", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bb-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Guarded ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Guarded/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Brass Key");
  await page.getByLabel("Price", { exact: true }).fill("12.00");
  await page.getByLabel("Stock", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const checkout = async (line1: string) => {
    await buyer.goto(store);
    await buyer.getByRole("button", { name: "Add to cart" }).click();
    await expect(buyer.getByRole("link", { name: /^Cart, \d item/ })).toBeVisible();
    await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).first().fill(`mallory-${id}@example.com`);
    await buyer.getByLabel("Full name").fill("Mallory Smith");
    await buyer.getByLabel("Address", { exact: true }).fill(line1);
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
  };
  await checkout("1 Main St");
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Mallory!" })).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await page.getByRole("button", { name: "Block this buyer" }).click();
  await page.getByLabel("Why (only you see this)").fill("Chargeback");
  await page.getByRole("button", { name: "Block buyer", exact: true }).click();
  await expect(page.getByText("Blocked from checking out")).toBeVisible();

  await checkout("22 Other Rd");
  await expect(buyer.getByRole("main").getByRole("alert")).toHaveText(/We can't take this order\./);

  await page.getByRole("link", { name: "See blocked buyers" }).click();
  await expect(page.getByRole("heading", { name: "2 blocked" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Chargeback · order" }).first()).toBeVisible();
  await page.getByRole("button", { name: `Unblock mallory-${id}@example.com` }).click();
  await expect(page.getByRole("heading", { name: "1 blocked" })).toBeVisible();
});
