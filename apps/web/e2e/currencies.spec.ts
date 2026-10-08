import { expect, test, type Page } from "@playwright/test";

// Selling in more currencies: the merchant turns on euros and pounds, a buyer switches to pounds,
// sees and pays in them, and the merchant's order shows what they paid. Rates are fixed in tests.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`fx-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lumen ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lumen/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
}

test("a buyer sees, pays and gets a receipt in pounds; the merchant sees what they paid", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const product = await newMerchantWithLamp(page, id);

  // Before any are turned on, buyers only see dollars and no picker.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await expect(buyer.getByLabel("Currency")).toHaveCount(0);

  await page.getByRole("link", { name: "Currencies" }).first().click();
  await expect(page.getByRole("heading", { name: "Currencies", exact: true })).toBeVisible();
  await page.getByLabel(/^EUR/).check();
  await page.getByLabel(/^GBP/).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByRole("row", { name: /GBP/ })).toContainText("£");
  await shot(page, "90-currencies");

  // The buyer switches to pounds; prices, cart, checkout and payment follow.
  await buyer.reload();
  await buyer.getByLabel("Currency").selectOption("GBP");
  await expect(buyer.getByLabel("Currency")).toHaveValue("GBP");
  await expect(buyer).toHaveURL(product);
  await expect(buyer.locator("main").getByText(/£\d+\.99/).first()).toBeVisible();
  await expect(buyer.locator("main").getByText("$")).toHaveCount(0);
  await shot(buyer, "91-store-in-pounds");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("main")).toContainText("£");
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByText("Prices in GBP at today's exchange rate")).toBeVisible();
  await buyer.getByLabel("Email").fill(`fx-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  const pay = buyer.getByRole("button", { name: /^Pay £/ });
  await expect(pay).toBeVisible();
  const paid = (await pay.textContent())!.match(/£[\d,.]+/)![0];
  await shot(buyer, "92-pay-in-pounds");
  await pay.click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByRole("main")).toContainText(paid);

  // The merchant's books stay in dollars and note what the buyer paid.
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: /#1001/ }).first().click();
  await expect(page.getByText("Buyer paid in GBP", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(paid);
  await shot(page, "93-order-paid-in-pounds");
});

test("a buyer in France gets euros without picking", async ({ page, browser }, info) => {
  const id = `${info.project.name}-fr-${Date.now()}`;
  const product = await newMerchantWithLamp(page, id);
  await page.goto("/admin/currencies");
  await page.getByLabel(/^EUR/).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  const french = await (await browser.newContext({ ...info.project.use, extraHTTPHeaders: { "x-vercel-ip-country": "FR" } })).newPage();
  await french.goto(product);
  await expect(french.getByLabel("Currency")).toHaveValue("EUR");
  await expect(french.locator("main").getByText(/€\d+\.99/).first()).toBeVisible();
  // They can still switch back to dollars.
  await french.getByLabel("Currency").selectOption("USD");
  await expect(french.locator("main").getByText(/\$\d+/).first()).toBeVisible();
});
