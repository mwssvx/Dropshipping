import { expect, test, type Page } from "@playwright/test";

// Sold out at the supplier: when every option of a product runs out, Home and the Products page
// say so, with a way to the product to add a backup supplier.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a product that sold out at the supplier shows on Home and the Products page", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`so-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Empty ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Empty/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const productUrl = new URL(page.url()).pathname;

  await page.goto("/admin/products");
  await expect(page.getByRole("heading", { name: "Sold out at the supplier" })).toHaveCount(0);

  // Every option runs out (the daily stock check would do this; here it's set by hand).
  await page.goto(productUrl);
  const fields = page.locator('input[id^="stock-"]');
  await expect(fields.first()).toHaveValue(/^\d+$/);
  for (const field of await fields.all()) await field.fill("0");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/admin");
  const item = page.getByRole("link", { name: /Sunset Projection Lamp is sold out at the supplier/ });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(/\/admin\/products#supplier-sold-out$/);
  const section = page.getByRole("region", { name: "Sold out at the supplier" });
  await expect(section).toContainText("Add a backup supplier on the product page");
  await expect(section.getByRole("listitem")).toHaveText(["Sunset Projection LampNo backup supplier"]);
  await shot(page, "400-sold-out-at-supplier");
  await section.getByRole("link", { name: "Sunset Projection Lamp" }).click();
  await expect(page).toHaveURL(new RegExp(`${productUrl}$`));

  // One option back is enough to sell again.
  await page.locator("#stock-0").fill("4");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/admin/products");
  await expect(page.getByRole("heading", { name: "Sold out at the supplier" })).toHaveCount(0);
});
