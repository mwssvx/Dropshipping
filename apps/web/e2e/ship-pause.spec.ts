import { expect, test } from "@playwright/test";

// Shipping pause: the merchant pauses shipping for a while (a supplier's New Year), the store keeps
// selling, every page says when orders ship again, and delivery dates move to count from then.

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const longDay = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(d);

test("pause shipping while still taking orders", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pause-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Pause ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Pause/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  const estimate = buyer.locator("#delivery-estimate");
  await expect(estimate).toContainText("Arrives");
  const before = await estimate.textContent();
  await expect(buyer.locator("#ship-pause")).toHaveCount(0);

  const resumes = new Date(Date.now() + 10 * DAY);
  await page.goto("/admin/shipping");
  await page.waitForLoadState("load");
  await page.getByLabel("Pause shipping for a while").check();
  await page.getByLabel("Orders ship again on").fill(iso(resumes));
  await page.getByLabel("A few words for buyers (optional)").fill("Our supplier is closed for New Year.");
  await page.getByRole("button", { name: "Save shipping pause" }).click();
  await expect(page.getByRole("status")).toContainText(`every store page says orders ship from ${longDay(resumes)}, and delivery dates count from then.`);

  await buyer.reload();
  await expect(buyer.locator("#ship-pause")).toHaveText(`Shipping is paused for a few days. Orders placed now ship from ${longDay(resumes)}, and delivery dates count from then.`);
  await expect(buyer.getByText("Our supplier is closed for New Year.")).toBeVisible();
  // Still selling, with later dates.
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeEnabled();
  await expect(estimate).toContainText("Arrives");
  expect(await estimate.textContent()).not.toBe(before);

  await page.reload();
  await expect(page.getByLabel("Orders ship again on")).toHaveValue(iso(resumes));
  await page.getByLabel("Pause shipping for a while").uncheck();
  await page.getByRole("button", { name: "Save shipping pause" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. Shipping isn't paused.");
  await buyer.reload();
  await expect(buyer.locator("#ship-pause")).toHaveCount(0);
  await expect(estimate).toHaveText(before!);
});
