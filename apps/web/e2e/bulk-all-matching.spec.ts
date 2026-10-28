import { expect, test } from "@playwright/test";

// Changing every product in a filtered list at once, past the first page.

test("a merchant tags every product in a list that spans pages", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bam-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bulk all ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bulk all/ })).toBeVisible();
  // 105 mugs and 3 caps, brought over from a Shopify file.
  const rows = [
    ...Array.from({ length: 105 }, (_, i) => `mug-${i},Mug ${i},12.00,draft`),
    ...Array.from({ length: 3 }, (_, i) => `cap-${i},Cap ${i},15.00,draft`),
  ];
  await page.goto("/admin/products/move");
  await page.getByLabel("Shopify products file (CSV)").setInputFiles({ name: "products_export.csv", mimeType: "text/csv", buffer: Buffer.from(["Handle,Title,Variant Price,Status", ...rows].join("\n")) });
  await page.getByRole("button", { name: "Add products" }).click();
  await expect(page.getByText("108 products added.")).toBeVisible();

  await page.goto("/admin/products?q=mug");
  await page.getByRole("checkbox", { name: "Select all products" }).check();
  await expect(page.getByText("All 100 on this page are selected.")).toBeVisible();
  await page.getByRole("button", { name: "Select all 105 in this list" }).click();
  await expect(page.getByText("105 products selected")).toBeVisible();
  await page.getByLabel("Change", { exact: true }).selectOption({ label: "Add a tag" });
  await page.getByLabel("Tag", { exact: true }).fill("kitchen");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Apply to 105 products" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added the tag" })).toBeVisible();

  // Every mug got it, the caps didn't.
  await page.goto("/admin/products");
  await expect(page.getByRole("navigation", { name: "Filter by tag" }).getByRole("link", { name: "kitchen 105" })).toBeVisible();

  // Unticking one goes back to just the ticked ones on this page.
  await page.goto("/admin/products?q=mug");
  await page.getByRole("checkbox", { name: "Select all products" }).check();
  await page.getByRole("button", { name: "Select all 105 in this list" }).click();
  await page.getByRole("checkbox", { name: "Select Mug 104", exact: true }).uncheck();
  await expect(page.getByText("99 products selected")).toBeVisible();
});
