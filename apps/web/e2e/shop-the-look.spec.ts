import { expect, test } from "@playwright/test";

// The home page's "Shop the look" section: one photo beside a few hand-picked products, and a
// button that adds every piece with nothing to choose to the cart at once.

test("a shopper adds a whole look to the cart in one tap", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`look-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Look ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Look/ })).toBeVisible();
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
  await page.getByLabel("Add a section").selectOption("shop_the_look");
  await page.getByLabel("Heading").fill("The desk set");
  // Newest first: the stand, then the lamp. A picked product can't be picked twice.
  await page.getByLabel("Piece 1").selectOption({ index: 1 });
  await expect(page.getByLabel("Piece 2").locator("option").nth(1)).toBeDisabled();
  await page.getByLabel("Piece 2").selectOption({ index: 2 });
  const look = preview.getByRole("region", { name: "The desk set" });
  await expect(look.getByRole("link", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await expect(look.getByRole("link", { name: /Magnetic Phone Stand/ })).toBeVisible();
  await expect(page.getByLabel("Piece 3")).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${store}/`);
  const section = buyer.getByRole("region", { name: "The desk set" });
  await expect(section.getByRole("link", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await section.getByRole("button", { name: /^Add (all|these \d+) to cart$/ }).click();
  await expect(buyer).toHaveURL(/\/cart/);
  await expect(buyer.getByRole("link", { name: /Sunset Projection Lamp|Magnetic Phone Stand/ }).first()).toBeVisible();
  await buyer.context().close();
});
