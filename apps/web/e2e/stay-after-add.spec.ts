import { expect, test } from "@playwright/test";

// A store can keep shoppers on the page after "Add to cart", with a note that links to the
// cart and checkout, instead of opening the cart each time.

test("a shopper keeps browsing after adding to the cart", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`stay-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Stay ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Stay/ })).toBeVisible();
  let product = "";
  for (const title of ["Desk Plant", "Tall Vase"]) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("12.00");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }
  const all = product.replace(/\/products\/.*$/, "/collections/all");

  await page.goto("/admin/products");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "After “Add to cart”" }) });
  await expect(panel.getByLabel("Open the cart")).toBeChecked();
  await panel.getByLabel("Stay on the page and show a note with the cart and checkout").check();
  await panel.getByRole("button", { name: "Save cart setting" }).click();
  await expect(panel.getByText("Saved. “Add to cart” in your store follows it now.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  // From a product page: the shopper stays there, and the cart count goes up.
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).first().click();
  const note = buyer.getByRole("status").filter({ hasText: "Added to your cart." });
  await expect(note).toBeVisible();
  await expect(buyer).toHaveURL(new RegExp(`${product.replace(/[/.]/g, "\\$&")}$`));
  await expect(buyer.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
  await note.getByRole("button", { name: "Close" }).click();
  await expect(note).toBeHidden();

  // From a product card in a collection: back to the collection, same note.
  await buyer.goto(all);
  await buyer.getByRole("button", { name: "Add to cart: Desk Plant" }).click();
  await expect(note).toBeVisible();
  await expect(buyer).toHaveURL(/\/collections\/all$/);
  await expect(buyer.getByRole("link", { name: "Cart, 2 items" })).toBeVisible();
  // The note doesn't come back when the page is reloaded.
  await buyer.reload();
  await expect(buyer.getByRole("link", { name: "Cart, 2 items" })).toBeVisible();
  await expect(note).toBeHidden();
  await buyer.getByRole("button", { name: "Add to cart: Tall Vase" }).click();
  await note.getByRole("link", { name: "View cart" }).click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.locator("main").getByText("Tall Vase").first()).toBeVisible();
  await expect(buyer.locator("main").getByText("Desk Plant").first()).toBeVisible();
  await buyer.context().close();
});
