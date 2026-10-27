import { expect, test } from "@playwright/test";

// Pick list: one list of what the orders waiting to ship need off the shelf, added up per option.

test("a pick list adds up what the waiting orders need", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pl-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Teas ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Teas/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Green Tea");
  await page.getByLabel("Price", { exact: true }).fill("8.00");
  await page.getByLabel("Stock", { exact: true }).fill("10");
  await page.getByLabel("SKU", { exact: true }).fill("TEA-G");
  await page.getByLabel("Shelf location").fill("B4");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const tea = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/orders/pick-list");
  await expect(page.getByText("Nothing to pick")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  for (const name of ["Ada Lovelace", "Grace Hopper"]) {
    await buyer.goto(tea);
    await buyer.getByRole("button", { name: "Add to cart" }).click();
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).fill(`pl-${name.split(" ")[0]}-${id}@example.com`);
    await buyer.getByLabel("Full name").fill(name);
    await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
    await buyer.getByRole("button", { name: /^Pay/ }).click();
    await expect(buyer.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
  }

  await page.goto("/admin/orders/packing-slips");
  await page.getByRole("link", { name: "Pick list" }).click();
  const list = page.getByRole("article", { name: "Pick list" });
  await expect(list).toContainText("2 orders · 2 items");
  const row = list.getByRole("row", { name: /Green Tea/ });
  await expect(row).toContainText("TEA-G");
  await expect(row.getByRole("cell").nth(1)).toHaveText("B4");
  await expect(row).toContainText("#1001, #1002");
  await expect(row.getByRole("cell").nth(4)).toHaveText("2");
  await expect(row.getByRole("cell").nth(5)).toHaveText("8");
  await expect(page.getByRole("button", { name: "Print pick list" })).toBeVisible();
});
