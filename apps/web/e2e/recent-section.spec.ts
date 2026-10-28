import { expect, test } from "@playwright/test";

// The home page's Recently viewed section: the products this shopper looked at, kept in their own
// browser. Shoppers who haven't looked at anything yet don't see it.

test("a shopper finds what they looked at on the home page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Looked ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Looked/ })).toBeVisible();
  let lamp = "";
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    lamp ||= (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }
  const store = lamp.replace(/\/products\/.*$/, "");

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("recently_viewed");
  // The preview has no shopper, so it shows the store's products as a stand-in.
  await expect(preview.locator("section.sf-recent").getByRole("heading", { name: "Recently viewed" })).toBeVisible();
  await page.getByLabel("Heading").fill("Pick up where you left off");
  await expect(preview.getByRole("heading", { name: "Pick up where you left off" })).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${store}/`);
  await expect(buyer.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expect(buyer.locator("section.sf-recent")).toHaveCount(0);
  await buyer.goto(lamp);
  await expect(buyer.getByRole("heading", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await buyer.goto(`${store}/`);
  const section = buyer.locator("section.sf-recent");
  await expect(section.getByRole("heading", { name: "Pick up where you left off" })).toBeVisible();
  await expect(section.getByRole("link", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await expect(section.getByRole("link", { name: /Magnetic Phone Stand/ })).toHaveCount(0);
  await buyer.context().close();
});
