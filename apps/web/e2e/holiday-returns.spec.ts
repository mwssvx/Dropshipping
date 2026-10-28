import { expect, test } from "@playwright/test";

// Holiday returns: orders paid in a holiday stretch can be returned for longer, and product pages
// say so while the stretch is on.

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const longDay = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

test("a store keeps returns open longer for holiday orders", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`hret-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Gifts ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Gifts/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(buyer.locator("#holiday-returns")).toHaveCount(0);

  await page.goto("/admin/returns");
  const settings = page.getByRole("region", { name: "Return policy" });
  await settings.getByLabel("Longer returns for holiday orders").check();
  await settings.getByLabel("First order day").fill(inDays(-1));
  await settings.getByLabel("Last order day").fill(inDays(30));
  await settings.getByLabel("Returns open until").fill(inDays(20));
  await settings.getByRole("button", { name: "Save holiday returns" }).click();
  await expect(settings.getByRole("alert")).toContainText("Returns have to stay open after the last order day.");
  await settings.getByLabel("Returns open until").fill(inDays(90));
  await settings.getByRole("button", { name: "Save holiday returns" }).click();
  await expect(settings.getByRole("status")).toContainText(/^Saved\. Orders paid from [A-Z][a-z]{2} \d{1,2} to [A-Z][a-z]{2} \d{1,2} can be returned until [A-Z][a-z]{2} \d{1,2}\.$/);

  await buyer.reload();
  await expect(buyer.locator("#holiday-returns")).toHaveText(`Bought for the holidays? You can return it until ${longDay(inDays(90))}.`);

  await page.reload();
  await settings.getByLabel("Longer returns for holiday orders").uncheck();
  await settings.getByRole("button", { name: "Save holiday returns" }).click();
  await expect(settings.getByText("Saved. Holiday orders have the usual return window.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(buyer.locator("#holiday-returns")).toHaveCount(0);
});
