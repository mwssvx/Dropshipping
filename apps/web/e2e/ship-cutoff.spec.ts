import { expect, test } from "@playwright/test";

// Same-day cutoff: the merchant says what time orders must be in by, and the product page counts down to it.

test("product pages count down to the shipping cutoff", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cut-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Fast ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Fast/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  const settings = page.getByRole("region", { name: "Delivery dates" });
  await settings.getByLabel("Processing days").fill("0");
  await settings.getByRole("button", { name: "Save delivery dates" }).click();
  await expect(settings.getByText("Saved. Product pages, order pages and receipts show the new dates.")).toBeVisible();
  await settings.getByLabel("Orders in by a set time ship that day").check();
  // The time zone starts at the store's own country.
  await expect(settings.getByLabel("Your time zone")).toHaveValue("America/New_York");
  await settings.getByLabel("Order by").selectOption("17");
  // Shipping every day keeps the next cutoff within a day, whenever this runs (a day and an hour the
  // evening the clocks go back).
  await settings.getByLabel("We ship at weekends").check();
  await settings.getByRole("button", { name: "Save cutoff" }).click();
  await expect(settings.getByText("Saved. Orders in by 5 PM ship that day.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.locator("#delivery-estimate").getByRole("timer")).toHaveText(/^Order within (1 day )?\d\d:\d\d:\d\d and it ships (today|[A-Z][a-z]+day)$/);

  await page.reload();
  await settings.getByLabel("Orders in by a set time ship that day").uncheck();
  await settings.getByRole("button", { name: "Save cutoff" }).click();
  await expect(settings.getByText("Saved. There's no same-day cutoff.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.locator("#delivery-estimate")).toBeVisible();
  await expect(buyer.locator("#delivery-estimate").getByRole("timer")).toHaveCount(0);
});
