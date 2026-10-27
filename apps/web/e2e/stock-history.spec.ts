import { expect, test } from "@playwright/test";

// Stock history: each change to the store's own count is listed on the product page with why.

test("the product page lists why the stock count changed", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sh-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Ledger ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Ledger/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Linen Shirt");
  await page.getByLabel("Price", { exact: true }).fill("30.00");
  await page.getByLabel("Stock", { exact: true }).fill("3");
  await expect(page.getByText("Stock goes down as orders are paid, and back if one is cancelled before it ships")).toBeVisible();
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const admin = page.url();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const stock = async () => {
    await page.goto(admin);
    return page.getByLabel("Stock", { exact: true }).inputValue();
  };

  const buy = async (email: string, name: string) => {
    const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
    await buyer.goto(store);
    await buyer.getByRole("button", { name: "Add to cart" }).click();
    await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
    await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).first().fill(email);
    await buyer.getByLabel("Full name").fill(name);
    await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
    await buyer.getByRole("button", { name: /^Pay / }).click();
    await expect(buyer.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
    return buyer;
  };

  const grace = await buy(`grace-${id}@example.com`, "Grace Hopper");
  await grace.getByText("Cancel this order").click();
  await grace.getByRole("button", { name: "Cancel order and refund me" }).click();
  await expect(grace.getByText(/^You cancelled this order on/)).toBeVisible();
  await page.goto(admin);
  await page.getByLabel("Stock", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  await page.goto(admin);
  await page.getByText("Stock history").click();
  const rows = page.locator("#stock-history tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("Changed by hand");
  await expect(rows.nth(0)).toContainText("+4");
  await expect(rows.nth(1)).toContainText("Back from order #1001, cancelled before it shipped");
  await expect(rows.nth(2)).toContainText("Sold on order #1001");
  await expect(rows.nth(2)).toContainText("-1");
  await expect(rows.nth(3)).toContainText("Starting count");
  await rows.nth(2).getByRole("link", { name: "order #1001" }).click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
});
