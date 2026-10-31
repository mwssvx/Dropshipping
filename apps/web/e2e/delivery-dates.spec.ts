import { expect, test, type Page } from "@playwright/test";

// Delivery dates: product pages say when an order placed today would arrive, and order pages say
// when it's expected. The merchant sets processing days on the Shipping page.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const WINDOW = /[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}/;

test("buyers see when their order will arrive", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`dd-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const productAdmin = page.url();

  // On by default, with 2 processing days; the merchant makes it 3.
  await page.goto("/admin/shipping");
  const settings = page.getByRole("region", { name: "Delivery dates" });
  await expect(settings.getByRole("note")).toContainText(/Today, Sunset Projection Lamp shows .* to United States\./);
  await settings.getByLabel("Processing days").fill("20");
  await settings.getByRole("button", { name: "Save delivery dates" }).click();
  await expect(settings.getByRole("alert")).toContainText("Processing time is between 0 and 14 days.");
  await expect(settings.getByLabel("Show delivery dates to buyers")).toBeChecked();
  await settings.getByLabel("Processing days").fill("3");
  await settings.getByRole("button", { name: "Save delivery dates" }).click();
  await expect(settings.getByText("Saved. Product pages, order pages and receipts show the new dates.")).toBeVisible();
  await shot(page, "281-delivery-settings");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  const estimate = buyer.locator("#delivery-estimate");
  await expect(estimate).toContainText(new RegExp(`Arrives ${WINDOW.source} to United States`));
  await expect(estimate).toContainText("Ships within 3 days, then 6–10 days in transit.");
  await shot(buyer, "282-delivery-estimate");

  // Made to order: this product takes a week to get ready, and its dates count that instead.
  await page.goto(productAdmin);
  const preparing = page.getByRole("region", { name: "Preparing time" });
  await preparing.getByLabel("Days to get it ready").fill("40");
  await preparing.getByRole("button", { name: "Save preparing time" }).click();
  await expect(preparing.getByRole("alert")).toContainText("Enter 0 to 30 days");
  await preparing.getByLabel("Days to get it ready").fill("7");
  await preparing.getByRole("button", { name: "Save preparing time" }).click();
  await expect(preparing.getByRole("status")).toHaveText("Saved. Delivery dates for this product count it.");
  await expect(preparing.getByRole("note")).toContainText("Ready to ship in 7 days");
  await buyer.reload();
  await expect(estimate).toContainText("Ships within 7 days, then 6–10 days in transit.");
  await page.goto("/admin/shipping");

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
  await expect(async () => {
    await buyer.reload();
    await expect(buyer.getByText(new RegExp(`^Expected delivery: ${WINDOW.source}$`))).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  // The merchant sees the same date on the order.
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  const expected = page.locator("#expected-delivery");
  await expect(expected).toContainText(/^Expected to arrive [A-Z][a-z]+ \d{1,2}, \d{4}( – [A-Z][a-z]+ \d{1,2}, \d{4})?$/);
  const orderPage = page.url();
  await page.goto("/admin/shipping");

  // Turned off: no dates.
  await settings.getByLabel("Show delivery dates to buyers").uncheck();
  await settings.getByRole("button", { name: "Save delivery dates" }).click();
  await expect(settings.getByText("Turned off. Buyers won't see delivery dates.")).toBeVisible();
  await buyer.goto(store);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.locator("#delivery-estimate")).toHaveCount(0);

  // The merchant still sees it, with a note that buyers don't.
  await page.goto(orderPage);
  await expect(expected).toContainText("Buyers don't see this date because delivery dates are off in Shipping settings.");
});
