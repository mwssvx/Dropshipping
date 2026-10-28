import { expect, test } from "@playwright/test";

// A featured products grid can show a pick from its collection: best sellers, the newest, or only
// what's on sale, with "View all" opening the same list.

test("a featured grid shows only what's on sale", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`fp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Picks ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Picks/ })).toBeVisible();
  let store = "";
  let stand = "";
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    store ||= (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
    stand = page.url();
  }
  await page.goto(stand);
  const price = await page.getByLabel("Price", { exact: true }).first().inputValue();
  await page.getByLabel("Compare-at price").first().fill(String(Number(price) + 5));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/^Saved\./).first()).toBeVisible();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("featured_products");
  await page.getByLabel("Heading").fill("On sale now");
  await page.getByLabel("Which products").selectOption("on_sale");
  const inPreview = preview.locator("section", { has: preview.getByRole("heading", { name: "On sale now" }) });
  await expect(inPreview.getByRole("link", { name: /Magnetic Phone Stand/ })).toBeVisible();
  await expect(inPreview.getByRole("link", { name: /Sunset Projection Lamp/ })).toHaveCount(0);
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${store}/`);
  const section = buyer.locator("section", { has: buyer.getByRole("heading", { name: "On sale now" }) });
  await expect(section.getByRole("link", { name: /Magnetic Phone Stand/ })).toBeVisible();
  await expect(section.getByRole("link", { name: /Sunset Projection Lamp/ })).toHaveCount(0);
  await section.getByRole("link", { name: "View all" }).click();
  await expect(buyer).toHaveURL(/\/collections\/all\?sale=1$/);
  await expect(buyer.getByLabel("On sale")).toBeChecked();
  await expect(buyer.getByRole("main").getByRole("listitem")).toHaveCount(1);
  await buyer.context().close();
});
