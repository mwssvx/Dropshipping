import { expect, test, type Page } from "@playwright/test";

// Checkout add-ons: the merchant offers the projector at checkout for 20% less, and a buyer who
// came for the lamp adds it with one tap without losing what they typed.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer adds the checkout add-on in one tap", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`addon-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Extras ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Extras/ })).toBeVisible();
  let lamp = "";
  for (const name of [/sunset projection lamp/i, /galaxy projector low stock/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    lamp ||= (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }

  await page.goto("/admin/addons");
  const product = page.getByLabel("Product");
  await product.selectOption((await product.locator("option").filter({ hasText: /galaxy/i }).first().getAttribute("value"))!);
  await page.getByLabel("Discount (%)").fill("20");
  await page.getByLabel("One line for buyers (optional)").fill("Turns any ceiling into a night sky");
  await page.getByRole("button", { name: "Add add-on" }).click();
  await expect(page.getByText("Add-on saved. Buyers see it at checkout.")).toBeVisible();
  const row = page.getByRole("listitem", { name: /Galaxy Projector/ });
  await expect(row).toContainText("20% off");
  await expect(row).toContainText("At checkout");

  // The buyer starts checking out with the lamp and adds the projector from the summary.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  const offer = buyer.getByRole("region", { name: "Add to your order" });
  await expect(offer).toContainText("Galaxy Projector");
  await expect(offer).toContainText("Turns any ceiling into a night sky");
  await expect(offer).toContainText("Save 20%");
  await shot(buyer, "141-addon-at-checkout");
  await offer.getByRole("button", { name: /^Add for \$/ }).click();
  await expect(buyer.getByText("Add-on price, 20% off")).toBeVisible();
  await expect(offer).toHaveCount(0);
  // What they typed is still there.
  await expect(buyer.getByRole("textbox", { name: "Email" })).toHaveValue(`ada-${id}@example.com`);
  await expect(buyer.getByLabel("Full name")).toHaveValue("Ada Lovelace");
  await shot(buyer, "142-addon-added");

  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.reload();
  await expect(row).toContainText("Bought on 1 order");
  await shot(page, "143-addons-admin");
});
