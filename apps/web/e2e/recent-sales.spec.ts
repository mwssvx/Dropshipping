import { expect, test } from "@playwright/test";

// "3 sold in the last 7 days" on a product page, counted from real paid orders. It's off until the
// merchant turns it on.

test("a product page says how many sold this week once the merchant turns it on", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Selling ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Selling/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // One buyer takes three.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(lamp.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByLabel("Quantity").fill("3");
  await buyer.getByRole("button", { name: "Update" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 3 items/ })).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // Off by default.
  await buyer.goto(lamp);
  await expect(buyer.getByRole("heading", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await expect(buyer.getByText(/sold in the last 7 days/)).toHaveCount(0);

  await page.goto("/admin/products");
  await page.getByLabel("Show how many sold in the last week").check();
  await page.getByRole("button", { name: "Save sales setting" }).click();
  await expect(page.getByText("Saved. Your product pages follow it now.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByText("3 sold in the last 7 days")).toBeVisible();
  await buyer.context().close();
});
