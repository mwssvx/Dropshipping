import { expect, test, type Page } from "@playwright/test";

// Purchase limits: the merchant caps a product per order and per customer. The buyer sees the
// limits on the product page, the cart says what to change, and checkout counts earlier orders.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a limited product can't be bought past its limits", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`limit-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Drop ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Drop/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // A most per order above the most per customer is refused.
  const section = page.getByRole("region", { name: "Purchase limits" });
  await section.getByLabel("Most per order").fill("3");
  await section.getByLabel("Most per customer").fill("2");
  await section.getByRole("button", { name: "Save limits" }).click();
  await expect(section.getByRole("alert")).toContainText("The most per order can't be more than the most per customer.");
  await section.getByLabel("Most per order").fill("2");
  await section.getByRole("button", { name: "Save limits" }).click();
  await expect(section.getByText("Saved. The cart and checkout now follow these limits.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Purchase limits" }).getByRole("note")).toHaveText("Buyers can order up to 2 per order, 2 per customer.");
  await shot(page, "341-purchase-limits-settings");

  // The buyer sees the limits, and the cart says when there are too many.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByText("Up to 2 per order · Limit 2 per customer")).toBeVisible();
  await shot(buyer, "342-purchase-limits-product");
  await buyer.getByLabel("Quantity").fill("2");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  const tooMany = buyer.getByText("Up to 2 per order. Lower the quantity to check out.");
  await expect(tooMany).toBeVisible();
  await shot(buyer, "343-purchase-limits-cart");
  // Checkout sends them back until it's fixed.
  await buyer.goto((await buyer.getByRole("link", { name: "Check out" }).getAttribute("href"))!);
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(tooMany).toBeVisible();
  await buyer.getByLabel("Quantity").fill("2");
  await buyer.getByRole("button", { name: "Update" }).click();
  await expect(tooMany).toHaveCount(0);

  const checkout = async () => {
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
    await buyer.getByLabel("Full name").fill("Ada Lovelace");
    await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
  };
  await checkout();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // Coming back for one more with the same email is past the per-customer limit.
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await checkout();
  await expect(buyer.getByText(/is limited to 2 per customer, and you've already bought 2\./)).toBeVisible();
  await shot(buyer, "344-purchase-limits-checkout");
});
