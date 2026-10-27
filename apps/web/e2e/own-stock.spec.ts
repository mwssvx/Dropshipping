import { expect, test } from "@playwright/test";

// The store's own stock: a product added by hand counts down as orders are paid, and the count
// goes back when a buyer cancels before it ships.

test("own stock goes down as it sells and back when an order is cancelled", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`os-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Shelf ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Shelf/ })).toBeVisible();

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
  expect(await stock()).toBe("2");
  await grace.getByText("Cancel this order").click();
  await grace.getByRole("button", { name: "Cancel order and refund me" }).click();
  await expect(grace.getByText(/^You cancelled this order on/)).toBeVisible();
  expect(await stock()).toBe("3");
  await buy(`ada-${id}@example.com`, "Ada Lovelace");
  expect(await stock()).toBe("2");
});
