import { expect, test } from "@playwright/test";

// Local delivery: a store with its own stock drops orders off itself to nearby postal codes, for
// its own price, and marks them delivered.

test("the store delivers an order itself to a nearby postal code", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ld-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bakery ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bakery/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Sourdough Loaf");
  await page.getByLabel("Price", { exact: true }).fill("8.00");
  await page.getByLabel("Stock", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  await page.getByLabel("Deliver orders myself nearby").check();
  await page.getByLabel("Postal codes you deliver to").fill("787, 78612");
  await page.getByLabel(/^Delivery price/).fill("3.50");
  await page.getByLabel("When it arrives (optional)").fill("Next morning");
  await page.getByRole("button", { name: "Save local delivery" }).click();
  await expect(page.getByText("Saved. Buyers in those areas can choose local delivery.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`grace-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Grace Hopper");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  // Outside the area there's no local delivery; inside, it's a choice next to the courier.
  const local = buyer.getByRole("radio", { name: /Local delivery/ });
  await buyer.getByLabel("Postal code").fill("73301");
  await expect(local).toHaveCount(0);
  await buyer.getByLabel("Postal code").fill("78701");
  await expect(local).not.toBeChecked();
  await expect(buyer.getByText("Next morning")).toBeVisible();
  await local.check();
  await expect(buyer.getByText("Shipping (Local delivery)")).toBeVisible();
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();
  await expect(buyer.getByText(/is delivering this order to you themselves\. Next morning\./)).toBeVisible();
  const orderPage = buyer.url();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "You're delivering this" })).toBeVisible();
  await page.getByRole("button", { name: "Delivered", exact: true }).click();
  await expect(page.getByText(/^Delivered on/)).toBeVisible();
  await buyer.goto(orderPage);
  await expect(buyer.getByText(/delivered this order\./)).toBeVisible();
});
