import { expect, test, type Page } from "@playwright/test";

// Pricing rules: the merchant sets their markup once. New imports start at it, and existing
// products can be brought in line after a preview.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a pricing rule prices imports and reprices existing products", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Margins ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Margins/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await expect(page.getByLabel("Price for Small")).toHaveValue("13.99");
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/pricing");
  await expect(page.getByText("Every product with a known supplier cost already follows your rule.")).toBeVisible();
  await page.getByLabel("Multiplier").fill("0.5");
  await page.getByRole("button", { name: "Save pricing rule" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("1.05 to 20");

  await page.getByLabel("Multiplier").fill("3");
  await page.getByLabel("Round up to").selectOption("95");
  await page.getByLabel("Show a crossed-out price").check();
  await page.getByLabel("Crossed-out price percent").fill("20");
  await page.getByRole("button", { name: "Save pricing rule" }).click();
  await expect(page.getByText("Pricing rule saved.")).toBeVisible();
  await expect(page.getByLabel("Round up to")).toHaveValue("95");
  await expect(page.getByLabel("Show a crossed-out price")).toBeChecked();
  // 5.59 × 3 = 16.77, up to 16.95; the lamp's Small option shows in the preview.
  const lampRow = page.getByRole("row").filter({ hasText: "Sunset Projection Lamp · Small" });
  await expect(lampRow).toContainText("$13.99");
  await expect(lampRow).toContainText("$16.95");
  await shot(page, "117-pricing");
  await page.getByRole("button", { name: "Update 1 product" }).click();
  await expect(page.getByText(/Updated 2 prices on 1 product/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Every product with a known supplier cost already follows your rule.")).toBeVisible();

  // The store shows the new price with the crossed-out one, and new imports start there too.
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /magnetic phone stand/i }).click();
  await expect(page.getByLabel(/^Price for/).first()).toHaveValue(/\.95$/);
});
