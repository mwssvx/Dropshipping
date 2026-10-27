import { expect, test } from "@playwright/test";

// Tips: the store asks for them at checkout, a buyer picks one, and it shows on the order.

test("a buyer adds a tip at checkout", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`tip-${id}@example.com`);
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

  await page.goto("/admin/addons");
  await page.getByLabel("Ask for a tip at checkout").check();
  await expect(page.getByLabel("Tip choice 2")).toHaveValue("15");
  await page.getByLabel("Thank-you line (optional)").fill("Every bag is roasted to order.");
  await page.getByRole("button", { name: "Save tips" }).click();
  await expect(page.getByText("Saved. Checkout asks buyers if they'd like to tip.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  // "No tip" is picked to start with.
  await expect(buyer.getByText("Every bag is roasted to order.")).toBeVisible();
  await expect(buyer.getByRole("radio", { name: "No tip" })).toBeChecked();
  const summary = buyer.getByRole("complementary");
  const before = await summary.locator("dd").last().textContent();
  await buyer.getByRole("radio", { name: /^15% · \$3\.00/ }).check();
  await expect(summary.getByText("Tip", { exact: true })).toBeVisible();
  await expect(summary.locator("dd").last()).not.toHaveText(before!);
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Tip", { exact: true })).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: /^Thank you/ })).toBeVisible();
  await expect(buyer.getByText("Tip", { exact: true })).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByText("Tip from the buyer")).toBeVisible();
  await expect(page.getByText("$3.00")).toBeVisible();
});
