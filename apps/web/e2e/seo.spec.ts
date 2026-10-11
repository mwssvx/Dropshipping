import { expect, test, type Page } from "@playwright/test";

// Search listings: the merchant writes a product's search title and description, sees a preview,
// and the store page uses them. The Search listings page lists what still needs work.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a product's search listing shows on the store and in the report", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`seo-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Found ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Found/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const productUrl = page.url().replace(/\?.*$/, "");
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // The demo products have no photos, so the report flags it.
  await page.goto("/admin/seo");
  const item = page.getByRole("listitem", { name: "Sunset Projection Lamp" });
  await expect(item).toContainText("No photo");
  await item.getByRole("link", { name: /Fix/ }).click();
  await expect(page).toHaveURL(new RegExp(`${productUrl.replace(/^https?:\/\/[^/]+/, "")}#seo-heading$`));

  // The preview follows what's typed; empty fields fall back to the product's own.
  const section = page.getByRole("region", { name: "Search engine listing" });
  const preview = section.getByLabel("Search result preview");
  await expect(preview).toContainText("Sunset Projection Lamp");
  await section.getByLabel("Search title").fill("Sunset lamp that turns any room golden");
  await section.getByLabel("Search description").fill("A sunset projection lamp in two sizes. Delivered in about a week, with easy returns.");
  await expect(preview).toContainText("Sunset lamp that turns any room golden");
  await expect(section.getByText("38 of 70 characters.")).toBeVisible();
  await section.getByRole("button", { name: "Save search listing" }).click();
  await expect(section.getByText("Saved. Search engines pick it up next time they visit.")).toBeVisible();
  await shot(page, "361-seo-listing");

  // The store page uses it.
  await page.goto(store);
  await expect(page).toHaveTitle("Sunset lamp that turns any room golden");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "A sunset projection lamp in two sizes. Delivered in about a week, with easy returns.");

  await page.goto("/admin/seo");
  await expect(page.getByRole("listitem", { name: "Sunset Projection Lamp" })).toContainText("Sunset lamp that turns any room golden");
  await shot(page, "362-seo-report");
});
