import { expect, test } from "@playwright/test";

// A collection's cover image shows behind its title on its page, unless the theme turns it off.

test("a collection's page shows its cover image as a banner", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`banner-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Banner ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Banner/ })).toBeVisible();
  const handle = `banner-${id}`.toLowerCase();

  for (const [title, cover] of [["Lamps", "https://example.com/lamps.jpg"], ["Mugs", ""]] as const) {
    await page.goto("/admin/collections/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Description").fill(`Our ${title.toLowerCase()}.`);
    await page.getByLabel("Cover image address").fill(cover);
    await page.getByRole("button", { name: "Save collection" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const banner = buyer.locator("main header.sf-collection-banner");
  await buyer.goto(`/s/${handle}/collections/lamps`);
  await expect(banner.getByRole("heading", { level: 1, name: "Lamps" })).toBeVisible();
  await expect(banner).toContainText("Our lamps.");
  await expect(banner.locator("img")).toHaveAttribute("src", "https://example.com/lamps.jpg");
  // Without a cover image, just the title.
  await buyer.goto(`/s/${handle}/collections/mugs`);
  await expect(buyer.getByRole("heading", { level: 1, name: "Mugs" })).toBeVisible();
  await expect(banner).toHaveCount(0);

  await page.goto("/admin/theme");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Show a collection’s photo behind its title").uncheck();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await buyer.goto(`/s/${handle}/collections/lamps`);
  await expect(buyer.getByRole("heading", { level: 1, name: "Lamps" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await buyer.context().close();
});
