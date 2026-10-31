import { expect, test, type Page } from "@playwright/test";

// Orders in more than one parcel: a cart with supplier products and the store's own stock says it
// comes in two parcels, and the order page lists what's in each.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("buyers know their order comes in two parcels", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Parcels ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Parcels/ })).toBeVisible();

  // One product from the demo supplier, one the store keeps on its own shelf.
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Beeswax Candle");
  await page.getByLabel("Price", { exact: true }).fill("12.00");
  await page.getByLabel("Stock", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const candle = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(lamp.replace(/\/products\/.*$/, "/cart"));
  await expect(buyer.locator("#cart-parcels")).toHaveCount(0);
  await buyer.goto(candle);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 2 items/ })).toBeVisible();
  await buyer.goto(lamp.replace(/\/products\/.*$/, "/cart"));
  const note = "Comes in 2 parcels from different warehouses, so they may arrive on different days.";
  await expect(buyer.locator("#cart-parcels")).toHaveText(note);

  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.locator("#parcels-note")).toHaveText(note);
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  const parcels = buyer.getByRole("region", { name: "Your order comes in 2 parcels" });
  await expect(async () => {
    await buyer.reload();
    await expect(parcels).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(parcels.getByRole("listitem")).toHaveCount(2);
  await expect(parcels.getByRole("listitem").filter({ hasText: "Beeswax Candle" })).toContainText("Not shipped yet");
  await expect(parcels.getByRole("listitem").filter({ hasText: "Sunset Projection Lamp" })).toBeVisible();
  await shot(buyer, "316-parcels");
});
