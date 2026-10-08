import { expect, test, type Page } from "@playwright/test";

// Selling in bulk: quantity discounts on a product for everyone, and wholesale prices for business
// buyers the merchant approves. A wholesale buyer signs in, sees lower prices, and can't check out
// below the store's minimum order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ws-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bulk ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bulk/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return { productAdmin: page.url().split("?")[0]!, product: (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))! };
}

async function signIn(buyer: Page, store: string, email: string) {
  await buyer.goto(`${store}/account`);
  await buyer.getByLabel("Email").fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  await expect(buyer.getByRole("status")).toContainText("We sent a 6-digit code");
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const subject = await inbox.getByRole("article").filter({ hasText: email }).first().getByRole("heading").textContent();
  await inbox.close();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();
  await expect(buyer.getByText(`Signed in as ${email}`)).toBeVisible();
}

test("quantity discounts lower the price for everyone who buys more", async ({ page, browser }, info) => {
  const id = `${info.project.name}-q-${Date.now()}`;
  const { productAdmin, product } = await newMerchantWithLamp(page, id);
  await page.goto(productAdmin);
  await page.getByLabel("Quantity 1").fill("5");
  await page.getByLabel("Percent off 1").fill("15");
  await page.getByLabel("Quantity 2").fill("2");
  await page.getByLabel("Percent off 2").fill("10");
  await page.getByRole("button", { name: "Save quantity discounts" }).click();
  await expect(page.getByText("Quantity discounts saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Quantity 1")).toHaveValue("2"); // stored smallest first

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  const tiers = buyer.getByRole("region", { name: "Buy more, save more" });
  await expect(tiers).toContainText("Buy 2 or more, save 10%");
  await expect(tiers).toContainText("Buy 5 or more, save 15%");
  await shot(buyer, "102-quantity-discounts");
  await buyer.getByLabel("Quantity").fill("2");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByText("Buy 2 or more, save 10%")).toBeVisible();
  await expect(buyer.locator("s").first()).toBeVisible(); // the full price, struck through
});

test("a business buyer applies, gets approved, and buys at wholesale prices above the minimum", async ({ page, browser }, info) => {
  const id = `${info.project.name}-w-${Date.now()}`;
  const { product } = await newMerchantWithLamp(page, id);
  const store = product.replace(/\/products\/.*$/, "");
  await page.goto("/admin/wholesale");
  await page.getByLabel("Sell wholesale").check();
  await page.getByLabel("Wholesale discount (%)").fill("30");
  await page.getByLabel("Minimum order").fill("1000");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Wholesale settings saved.")).toBeVisible();

  // The buyer signs in and applies from their account page.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const email = `corner-${id}@example.com`;
  await signIn(buyer, store, email);
  const section = buyer.getByRole("region", { name: "Buying for a business?" });
  await section.getByLabel("Business name").fill("Corner Shop");
  await section.getByLabel("Tax or resale number (optional)").fill("RS-123");
  await section.getByLabel("What do you sell, and where? (optional)").fill("Gifts and lighting, two shops in Austin.");
  await section.getByRole("button", { name: "Apply for wholesale" }).click();
  await expect(section.getByRole("status")).toContainText("is looking at your application for Corner Shop");

  // The merchant sees it waiting and approves it.
  await page.goto("/admin/wholesale");
  await expect(page.getByRole("link", { name: /Wholesale/ }).getByText("1")).toBeVisible();
  const application = page.getByRole("listitem", { name: "Corner Shop" });
  await expect(application).toContainText("RS-123");
  await expect(application).toContainText("two shops in Austin");
  await shot(page, "103-wholesale-admin");
  await application.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("region", { name: "Wholesale buyers" }).getByText("Corner Shop")).toBeVisible();
  const mail = await page.context().newPage();
  await mail.goto("/dev/mail");
  await expect(mail.getByRole("article").filter({ hasText: email }).filter({ hasText: "You have wholesale prices" })).toContainText("30% less");
  await mail.close();

  // Wholesale prices show on the product and in the cart; the minimum blocks checkout.
  await buyer.goto(product);
  await expect(buyer.getByRole("status").filter({ hasText: "Your wholesale price" })).toContainText("30% off");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByText("Wholesale price, 30% off")).toBeVisible();
  await expect(buyer.getByRole("status").filter({ hasText: "wholesale prices" })).toContainText("Wholesale orders start at $1,000.00");
  await expect(buyer.getByRole("link", { name: "Check out" })).toHaveCount(0);
  await shot(buyer, "104-wholesale-cart");
  await buyer.goto(`${store}/checkout`);
  await expect(buyer).toHaveURL(/\/cart$/);

  // With no minimum, the order goes through and is marked as wholesale.
  await page.goto("/admin/wholesale");
  await page.getByLabel("Minimum order").fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Wholesale settings saved.")).toBeVisible();
  await buyer.goto(`${store}/cart`);
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).first().getAttribute("href"))!);
  await expect(page.getByText("Wholesale order")).toBeVisible();
});
