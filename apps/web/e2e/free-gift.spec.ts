import { expect, test } from "@playwright/test";

// Free gift: the store gives a tote bag with orders over $50. The cart says how much more it
// takes, then the gift comes with the order for nothing.

test("a free gift is added once the cart is over the amount", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`gift-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Roaster ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Roaster/ })).toBeVisible();

  for (const [title, price] of [["Tote bag", "12.00"], ["House Blend", "20.00"]]) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title!);
    await page.getByLabel("Price", { exact: true }).fill(price!);
    await page.getByLabel("Stock", { exact: true }).fill("5");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/addons");
  await page.getByLabel("Give a free gift with bigger orders").check();
  await page.getByLabel("Gift to give").selectOption({ label: "Tote bag" });
  await page.getByLabel("For orders over").fill("50");
  await page.getByRole("button", { name: "Save free gift" }).click();
  await expect(page.getByText("Saved. Carts show how much more it takes")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await expect(buyer.getByText("Spend $30.00 more and get Tote bag free.")).toBeVisible();
  await expect(buyer.getByRole("listitem", { name: "Free gift" })).toHaveCount(0);

  await buyer.getByLabel("Quantity").fill("3");
  await buyer.getByRole("button", { name: "Update" }).click();
  const gift = buyer.getByRole("listitem", { name: "Free gift" });
  await expect(gift.getByRole("link", { name: "Tote bag" })).toBeVisible();
  await expect(gift.getByText("Free", { exact: true })).toBeVisible();
  await expect(buyer.getByText(/more and get Tote bag free/)).toHaveCount(0);

  await buyer.getByRole("link", { name: "Check out" }).click();
  const summary = buyer.getByRole("complementary");
  await expect(summary.getByText("Free gift")).toBeVisible();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: /^Thank you/ })).toBeVisible();
  await expect(buyer.getByText("Tote bag (free gift)").first()).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByText("Tote bag (free gift)").first()).toBeVisible();
});
