import { expect, test } from "@playwright/test";

// Bank transfers: on a paid plan the merchant adds their account details, a buyer chooses to pay
// by transfer and is shown where to send it, and the merchant marks it paid when it arrives.

test("a buyer pays by bank transfer and the merchant marks it paid", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bt-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Transfers ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Transfers/ })).toBeVisible();

  // The free plan's fee comes out of card payments, so transfers need a paid plan.
  await page.goto("/admin/orders?show=transfers");
  await expect(page.getByText("Bank transfers are on paid plans")).toBeVisible();
  await page.goto("/admin/plan");
  await page.getByRole("button", { name: "Upgrade to Growth" }).click();
  await expect(page.getByRole("heading", { name: "You're on Growth" })).toBeVisible();
  await page.goto("/admin/orders?show=transfers");
  await page.getByLabel("Let buyers pay by bank transfer").check();
  await page.getByLabel("Account to pay into").fill("Transfers Ltd\nIBAN DE89 3704 0044 0532 0130 00");
  await page.getByLabel("Days to pay").fill("5");
  await page.getByRole("button", { name: "Save bank transfers" }).click();
  await expect(page.getByText("Saved. Buyers can now pay by bank transfer on the payment page.")).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Oak Shelf");
  await page.getByLabel("Price", { exact: true }).fill("120.00");
  await page.getByLabel("Stock", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

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
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByRole("heading", { name: "Pay by bank transfer" })).toBeVisible();
  await buyer.getByRole("button", { name: "Pay by bank transfer" }).click();

  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const transfer = buyer.locator("#transfer");
  await expect(transfer.getByText("IBAN DE89 3704 0044 0532 0130 00")).toBeVisible();
  await expect(transfer.getByText("Reference: Order 1001")).toBeVisible();
  await expect(transfer.getByRole("link", { name: "Rather pay by card?" })).toBeVisible();
  const orderPage = buyer.url().replace(/#.*$/, "");

  await page.goto("/admin/orders?show=transfers");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Waiting for a bank transfer" })).toBeVisible();
  await expect(page.getByText("Order 1001", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark as paid" }).click();
  await expect(page.getByText(/^Marked as paid\./)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting for a bank transfer" })).toHaveCount(0);

  await buyer.goto(orderPage);
  await expect(buyer.getByText(/We.ve emailed a receipt to/)).toBeVisible();
  await expect(buyer.locator("#transfer")).toHaveCount(0);
});
