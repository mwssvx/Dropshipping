import { expect, test } from "@playwright/test";

// Codes for chosen products: SUMMER20 takes 20% off the summer range and nothing else.

test("a code for one product takes money off that product only", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Seasons ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Seasons/ })).toBeVisible();

  const stores: string[] = [];
  for (const [title, price] of [["Straw Sun Hat", "20.00"], ["Wool Scarf", "30.00"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    stores.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  }

  await page.goto("/admin/marketing");
  await page.getByLabel("Code", { exact: true }).fill("summer20");
  await page.getByLabel("Percent").fill("20");
  await page.getByRole("group", { name: /Products it's for/ }).getByLabel("Straw Sun Hat").check();
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Code created. Buyers can use it now.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "SUMMER20" })).toContainText("20% off selected products");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  // With only the scarf, the code doesn't apply.
  await buyer.goto(stores[1]!);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(stores[1]!.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByLabel("Discount or gift card code").fill("summer20");
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText("SUMMER20 is for some products only, and none of them are in your cart.")).toBeVisible();

  // With the hat too, 20% comes off the hat's $20.00: $4.00, not 20% of the whole $50.00.
  await buyer.goto(stores[0]!);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 2 items/ })).toBeVisible();
  await buyer.goto(stores[0]!.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByLabel("Discount or gift card code").fill("summer20");
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText("Discount (SUMMER20)")).toBeVisible();
  await expect(buyer.getByText("−$4.00")).toBeVisible();
});
