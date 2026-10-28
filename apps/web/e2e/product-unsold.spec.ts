import { expect, test } from "@playwright/test";

// The product list filtered to products on sale that haven't sold in 30 or 90 days. A product
// added today hasn't had its chance yet, so it never counts and the row stays hidden.

test("a new product doesn't count as not selling", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pu-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Unsold ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Unsold/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/products");
  await expect(page.getByRole("link", { name: /Sunset Projection Lamp/ }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Filter by not sold" })).toHaveCount(0);

  // A saved link still opens the filter, with what it means and nothing in it.
  await page.goto("/admin/products?unsold=30");
  await expect(page.getByText("Products on sale for more than 30 days with no paid order in that time.", { exact: false })).toBeVisible();
  const row = page.getByRole("navigation", { name: "Filter by not sold" });
  await expect(row.getByRole("link", { name: /30 days/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No products here.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download these products as a spreadsheet" })).toHaveAttribute("href", /unsold=30/);
  await row.getByRole("link", { name: /30 days/ }).click();
  await expect(page).not.toHaveURL(/unsold=/);
  await expect(page.getByRole("link", { name: /Sunset Projection Lamp/ }).first()).toBeVisible();
});
