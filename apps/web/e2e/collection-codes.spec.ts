import { expect, test } from "@playwright/test";

// Codes for a collection: SUMMER20 takes 20% off what's in the Summer collection.

test("a code for a collection takes money off the products in it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Ranges ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Ranges/ })).toBeVisible();

  const stores: string[] = [];
  for (const [title, price] of [["Straw Sun Hat", "20.00"], ["Wool Scarf", "30.00"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    stores.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  }
  await page.goto("/admin/collections/new");
  await page.getByLabel("Title").fill("Summer");
  await page.getByRole("button", { name: /Straw Sun Hat/ }).click();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/admin/marketing");
  await page.getByLabel("Code", { exact: true }).fill("summer20");
  await page.getByLabel("Percent").fill("20");
  await page.getByLabel("Collection it's for").selectOption({ label: "Summer" });
  // A collection takes the place of ticking products.
  await expect(page.getByRole("group", { name: /Products it's for/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Code created. Buyers can use it now.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "SUMMER20" })).toContainText("20% off Summer");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const cart = stores[0]!.replace(/\/products\/.*$/, "/cart");
  await buyer.goto(stores[1]!);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(cart);
  await buyer.getByLabel("Discount or gift card code").fill("summer20");
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText("SUMMER20 is for Summer, and nothing from it is in your cart.")).toBeVisible();

  await buyer.goto(stores[0]!);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 2 items/ })).toBeVisible();
  await buyer.goto(cart);
  await buyer.getByLabel("Discount or gift card code").fill("summer20");
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText("Discount (SUMMER20)")).toBeVisible();
  await expect(buyer.getByText("−$4.00")).toBeVisible();
});
