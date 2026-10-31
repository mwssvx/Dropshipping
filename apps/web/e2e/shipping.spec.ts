import { expect, test, type Page } from "@playwright/test";

// Shipping by country: the merchant sets up zones and rates, and the buyer picks a rate at checkout
// with the order summary following their choice.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ship-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Parcel ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Parcel/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
}

test("the buyer picks a shipping rate for their country and the summary follows", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const lamp = await newMerchantWithLamp(page, id);
  await page.goto("/admin/shipping");
  await expect(page.getByText("You use the standard rate")).toBeVisible();
  await page.getByRole("button", { name: "Set up shipping zones" }).click();
  const us = page.getByRole("listitem", { name: "United States zone" });
  await expect(us).toContainText("Express");
  await expect(us).toContainText("2–4 days");

  // A zone for Canada with its own rate.
  const add = page.getByRole("region", { name: "Add a zone" });
  await add.getByLabel("Zone name").fill("Canada");
  await add.getByRole("checkbox", { name: "Canada", exact: true }).check();
  await add.getByRole("button", { name: "Add zone" }).click();
  const canada = page.getByRole("listitem", { name: "Canada zone" });
  await expect(canada).toContainText("No rates yet");
  await canada.getByText("Add a rate").click();
  await canada.getByLabel("Rate name").fill("Tracked");
  await canada.getByLabel(/^Price/).fill("6.99");
  await canada.getByLabel("Days from").fill("4");
  await canada.getByLabel("Days to").fill("8");
  await canada.getByRole("button", { name: "Add rate" }).click();
  await expect(canada.getByRole("listitem", { name: "Canada: Tracked" })).toContainText("$6.99");
  await shot(page, "107-shipping-zones");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  const summary = buyer.locator("aside");
  await expect(buyer.getByLabel("Country")).toHaveValue("US");
  await expect(summary).toContainText("Shipping (Standard)$4.99");
  await buyer.getByRole("radio", { name: /Express/ }).check();
  await expect(summary).toContainText("Shipping (Express)$14.99");
  await buyer.getByLabel("Country").selectOption("CA");
  await expect(buyer.getByRole("radio")).toHaveCount(1);
  await expect(summary).toContainText("Shipping (Tracked)$6.99");
  // With the store's processing days counted, as real dates.
  await expect(buyer.getByText(/^Arrives [A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}$/)).toBeVisible();
  await buyer.getByLabel("Country").selectOption("JP");
  await expect(summary).toContainText("Shipping (Standard)$14.99");
  await buyer.getByLabel("Country").selectOption("US");
  await buyer.getByRole("radio", { name: /Express/ }).check();
  await shot(buyer, "108-checkout-shipping");

  await buyer.getByRole("textbox", { name: "Email" }).fill(`ship-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Shipping (Express)")).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).first().getAttribute("href"))!);
  await expect(page.getByText("Shipping (Express)")).toBeVisible();

  // Without the International zone, other countries can't be picked any more.
  await page.goto("/admin/shipping");
  await page.getByRole("button", { name: "Delete International zone" }).click();
  await expect(page.getByRole("listitem", { name: "International zone" })).toHaveCount(0);
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByLabel("Country").locator("option")).toHaveText(["Canada", "United States"]);
});
