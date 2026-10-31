import { expect, test } from "@playwright/test";

// Deliver to: a shopper whose order goes to another country than where they are picks it on the
// product page, and shipping, delivery dates, the cart and checkout follow.

test("a shopper picks the country their order goes to", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`dt-${id}@example.com`);
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

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  const deliverTo = buyer.locator("#deliver-to");
  await expect(deliverTo).toHaveText("Delivering to United States · Change");
  await expect(buyer.locator("#shipping-cost")).toContainText("United States");
  await deliverTo.getByRole("button", { name: "Change" }).click();
  await buyer.getByLabel("Deliver to").selectOption("GB");
  await expect(deliverTo).toHaveText("Delivering to United Kingdom · Change");
  await expect(buyer.locator("#shipping-cost")).toContainText("United Kingdom");
  await expect(buyer.locator("#delivery-estimate")).toContainText("to United Kingdom");

  // The choice is remembered, and checkout starts there.
  await buyer.reload();
  await expect(deliverTo).toHaveText("Delivering to United Kingdom · Change");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByLabel("Country")).toHaveValue("GB");
});
