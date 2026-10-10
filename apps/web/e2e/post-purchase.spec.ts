import { expect, test, type Page } from "@playwright/test";

// The after-checkout offer: right after paying, the order page offers one more product, and one
// click adds it to the same card as its own order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer adds the after-checkout offer with one click", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();
  let store = "";
  for (const name of [/magnetic phone stand/i, /sunset projection lamp/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }

  await page.goto("/admin/marketing");
  const offer = page.getByRole("region", { name: "After-checkout offer" });
  await offer.getByLabel(/Offer one more product right after checkout/).check();
  await offer.getByRole("button", { name: "Save after-checkout offer" }).click();
  await expect(offer.getByRole("alert")).toContainText("Pick a product to offer.");
  await offer.getByLabel("Product to offer").selectOption({ label: "Magnetic Phone Stand" });
  await offer.getByLabel("Percent off").fill("20");
  await offer.getByRole("button", { name: "Save after-checkout offer" }).click();
  await expect(offer.getByText("Saved. Buyers see it on their order page right after paying.")).toBeVisible();
  await shot(page, "261-after-checkout-setting");

  // The buyer buys the lamp, then adds the stand from the order page.
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
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const card = buyer.getByRole("region", { name: /Add Magnetic Phone Stand for 20% off\?/ });
  await expect(async () => {
    await buyer.reload();
    await expect(card).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await shot(buyer, "262-after-checkout-offer");
  await card.getByRole("button", { name: /^Add to my order · \$[\d.]+$/ }).click();
  await expect(buyer.getByText(/Added as order #1002 and charged \$[\d.]+ to the same card\./)).toBeVisible();
  await expect(card).toHaveCount(0);
  await buyer.getByRole("link", { name: "See it" }).click();
  await expect(buyer.getByText(/You added this after checking out, to the same card as order #1001\./)).toBeVisible();

  // The merchant sees both orders, linked.
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1002" }).getAttribute("href"))!);
  await expect(page.getByText("Added after checkout", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "order #1001" }).click();
  await expect(page.getByText(/The buyer added order #1002 after checkout\./)).toBeVisible();
  await page.goto("/admin/marketing");
  await expect(page.getByRole("region", { name: "After-checkout offer" }).getByText("Times added").locator("..")).toContainText("1");
});
