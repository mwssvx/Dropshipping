import { expect, test } from "@playwright/test";

// Save for later: a buyer moves something out of the cart onto their saved items.

test("a buyer moves a cart item to their saved items", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`later-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Roaster ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Roaster/ })).toBeVisible();
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("House Blend");
  await page.getByLabel("Price", { exact: true }).fill("20.00");
  await page.getByLabel("Stock", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("button", { name: "Save for later: House Blend" }).click();
  await expect(buyer.getByText("Moved to your saved items.")).toBeVisible();
  await expect(buyer.getByText("Your cart is empty.")).toBeVisible();
  await buyer.getByRole("link", { name: "See your saved items" }).click();
  await expect(buyer.getByRole("link", { name: "House Blend" })).toBeVisible();
});
