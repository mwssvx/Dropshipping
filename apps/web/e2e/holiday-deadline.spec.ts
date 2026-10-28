import { expect, test } from "@playwright/test";

// Holiday order-by date: the merchant names a holiday and the day orders must arrive by, and product
// pages and the cart say the last day to order.

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("product pages and the cart say the last day to order for a holiday", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`holiday-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Festive ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Festive/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  const settings = page.getByRole("region", { name: "Delivery dates" });
  await settings.getByLabel("Show an order-by date for a holiday").check();
  await settings.getByLabel("Holiday", { exact: true }).fill("Christmas");
  await settings.getByLabel("Must arrive by").fill(inDays(60));
  await settings.getByRole("button", { name: "Save holiday date" }).click();
  await expect(settings.getByText(/^Saved\. Product pages say when to order for Christmas, arriving by [A-Z][a-z]{2} \d{1,2}\.$/)).toBeVisible();
  await page.reload();
  await expect(settings.getByRole("note")).toContainText(/Order by [A-Z][a-z]{2} \d{1,2} for Christmas\./);

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.locator("#holiday-deadline")).toHaveText(/^Order by [A-Z][a-z]{2} \d{1,2} to get it in time for Christmas\.$/);
  const orderBy = (await buyer.locator("#holiday-deadline").textContent())!;
  // The cart says the same, under the dates for everything in it.
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await expect(buyer.locator("#cart-delivery")).toContainText(/^Arrives [A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2} to United States/);
  await expect(buyer.locator("#cart-holiday")).toHaveText(orderBy);
  await buyer.goto(store);

  // Arriving tomorrow is out of reach for a supplier order.
  await settings.getByLabel("Must arrive by").fill(inDays(1));
  await settings.getByRole("button", { name: "Save holiday date" }).click();
  await expect(settings.getByRole("status")).toContainText("Saved.");
  await buyer.reload();
  await expect(buyer.locator("#holiday-deadline")).toHaveText("Ordered now, it may not arrive in time for Christmas.");

  await settings.getByLabel("Show an order-by date for a holiday").uncheck();
  await settings.getByRole("button", { name: "Save holiday date" }).click();
  await expect(settings.getByText("Saved. There's no holiday order-by date.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.locator("#delivery-estimate")).toBeVisible();
  await expect(buyer.locator("#holiday-deadline")).toHaveCount(0);
});
