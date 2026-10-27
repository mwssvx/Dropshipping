import { expect, test } from "@playwright/test";

// Gift wrapping: the store offers it for a price, a buyer sending a gift adds it, and the order
// and packing slip say to wrap it.

test("a buyer has a gift wrapped at checkout", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`gw-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Wrapped ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Wrapped/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Scented Candle");
  await page.getByLabel("Price", { exact: true }).fill("20.00");
  await page.getByLabel("Stock", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  await page.getByLabel("Offer gift wrapping").check();
  await page.getByLabel(/^Wrapping price/).fill("4.50");
  await page.getByLabel("What they get (optional)").fill("Kraft paper and a ribbon");
  await page.getByRole("button", { name: "Save gift wrapping" }).click();
  await expect(page.getByText("Saved. Buyers sending a gift can have it wrapped.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`grace-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  // Wrapping is offered once it's a gift, and never ticked for the buyer.
  await expect(buyer.getByText("Gift wrap it for $4.50")).toHaveCount(0);
  await buyer.getByLabel("This order is a gift").check();
  await buyer.getByLabel("From (your name)").fill("Grace");
  const wrap = buyer.getByRole("checkbox", { name: /Gift wrap it for \$4\.50/ });
  await expect(wrap).not.toBeChecked();
  await expect(buyer.getByText("Kraft paper and a ribbon")).toBeVisible();
  const summary = buyer.getByRole("complementary");
  const before = await summary.locator("dd").last().textContent();
  await wrap.check();
  await expect(summary.getByText("Gift wrapping")).toBeVisible();
  await expect(summary.locator("dd").last()).not.toHaveText(before!);
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Gift wrapping")).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();
  await expect(buyer.getByText("Gift wrapping")).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByText("Wrap it")).toBeVisible();
  await expect(page.getByText("$4.50")).toBeVisible();
  await page.getByRole("link", { name: "Packing slip" }).click();
  await expect(page.getByText(/^Gift wrap this order\./)).toBeVisible();
});
