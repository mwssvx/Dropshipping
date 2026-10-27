import { expect, test } from "@playwright/test";

// Exchanges: a buyer whose socks don't fit asks for the other size instead of a refund, and the
// merchant sends it as a free order.

test("a buyer swaps for another size and the merchant sends it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ex-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Socks ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Socks/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Wool Socks");
  await page.getByLabel("Price", { exact: true }).fill("12.00");
  await page.getByRole("button", { name: "Add options like size or colour" }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Size");
  await page.getByLabel("Option 1 values, separated by commas").fill("S, M");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByRole("group", { name: "Size: S" })).toBeVisible();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ex-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // The merchant ships it from their own stock.
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).first().getAttribute("href"))!);
  await page.getByRole("button", { name: "Add tracking yourself" }).first().click();
  await page.getByLabel("Carrier").fill("USPS");
  await page.getByLabel("Tracking number").fill("9400111899223");
  await page.getByRole("button", { name: "Mark as shipped" }).click();
  await expect(page.getByText("Shipped", { exact: true }).first()).toBeVisible();

  await buyer.reload();
  await buyer.getByText("Return something").click();
  await buyer.getByLabel("Why?").selectOption({ label: "It doesn't fit" });
  await buyer.getByLabel("Instead of your money back").selectOption({ label: "Swap for Wool Socks – M" });
  await buyer.getByRole("button", { name: "Ask for a return" }).click();
  await expect(buyer.locator("#returns")).toContainText("you asked for a return");

  await page.goto("/admin/returns");
  const request = page.getByRole("listitem", { name: "Return for order #1001" });
  await expect(request).toContainText("Wants instead: Wool Socks – M × 1");
  await request.getByRole("button", { name: "Send the exchange" }).click();
  const answered = page.getByRole("listitem", { name: "Answered return for order #1001" });
  await expect(answered).toContainText("Exchange sent");
  await answered.getByRole("link", { name: "Exchange" }).click();
  await expect(page.getByText("Wool Socks – M").first()).toBeVisible();

  await buyer.reload();
  await expect(buyer.locator("#returns")).toContainText("is sending Wool Socks – M in exchange.");
});
