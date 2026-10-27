import { expect, test } from "@playwright/test";

// The admin product list: search by title or SKU, and filter by on sale, drafts or archived.

test("search and filter the product list", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pl-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`List ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to List/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/products");
  await expect(page.getByRole("checkbox", { name: /Select Sunset Projection Lamp/ })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search products" }).fill("sunset");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=sunset/);
  await expect(page.getByRole("checkbox", { name: /Select Sunset Projection Lamp/ })).toBeVisible();

  await page.getByRole("navigation", { name: "Product filters" }).getByRole("link", { name: "Drafts" }).click();
  await expect(page).toHaveURL(/status=draft/);
  await expect(page.getByText('No products match "sunset".')).toBeVisible();

  await page.getByRole("navigation", { name: "Product filters" }).getByRole("link", { name: "On sale" }).click();
  await expect(page.getByRole("checkbox", { name: /Select Sunset Projection Lamp/ })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search products" }).fill("teapot");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText('No products match "teapot".')).toBeVisible();
  await page.getByRole("link", { name: "See all products" }).click();
  await expect(page.getByRole("checkbox", { name: /Select Sunset Projection Lamp/ })).toBeVisible();
});
