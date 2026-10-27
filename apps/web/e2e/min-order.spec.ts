import { expect, test } from "@playwright/test";

// Smallest order: the store takes orders of $15 or more, so a $10 cart is asked to add a little.

test("a cart under the smallest order is asked to add more before checkout", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`min-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Stickers ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Stickers/ })).toBeVisible();
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Sticker pack");
  await page.getByLabel("Price", { exact: true }).fill("10.00");
  await page.getByLabel("Stock", { exact: true }).fill("9");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  await page.getByRole("textbox", { name: /^Smallest order/ }).fill("15");
  await page.getByRole("button", { name: "Save smallest order" }).click();
  await expect(page.getByText("Saved. Smaller carts are asked to add a little more before checkout.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  const cart = store.replace(/\/products\/.*$/, "/cart");
  await buyer.goto(cart);
  await expect(buyer.getByText("Orders start at $15.00: add $5.00 more to check out.")).toBeVisible();
  await expect(buyer.getByRole("link", { name: "Check out" })).toHaveCount(0);
  // Going straight to checkout comes back to the cart.
  await buyer.goto(cart.replace(/\/cart$/, "/checkout"));
  await expect(buyer).toHaveURL(/\/cart$/);

  await buyer.getByLabel("Quantity").fill("2");
  await buyer.getByRole("button", { name: "Update" }).click();
  await expect(buyer.getByText(/Orders start at/)).toHaveCount(0);
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByRole("button", { name: "Continue to payment" })).toBeVisible();
});
