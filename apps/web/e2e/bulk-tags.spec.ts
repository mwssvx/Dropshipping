import { expect, test } from "@playwright/test";

// Tags in bulk: tick products, add a tag to all of them, filter by it, undo, and find it in the download.

test("a merchant tags many products at once, then undoes it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bt-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bulk tags ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bulk tags/ })).toBeVisible();
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  }

  await page.goto("/admin/products");
  await page.getByRole("checkbox", { name: "Select all products" }).check();
  await expect(page.getByText("2 products selected")).toBeVisible();
  await page.getByLabel("Change", { exact: true }).selectOption({ label: "Add a tag" });
  await page.getByLabel("Tag", { exact: true }).fill("Summer");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("table", { name: "What will change" });
  await expect(preview.getByRole("row", { name: /Magnetic Phone Stand/ })).toContainText("summer");
  await page.getByRole("button", { name: "Apply to 2 products" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added the tag “summer” on 2 products." })).toBeVisible();

  // The new tag shows up as a filter with both products in it.
  const tags = page.getByRole("navigation", { name: "Filter by tag" });
  await expect(tags.getByRole("link", { name: /summer\s*2/ })).toBeVisible();

  // It's in the products download too.
  const csv = await (await page.request.get("/admin/export/products.csv")).text();
  expect(csv.split("\n")[0]).toMatch(/,Tags$/);
  expect(csv).toContain(",summer\n");

  const recent = page.getByRole("region", { name: "Recent changes" });
  await recent.getByRole("button", { name: "Undo: Added the tag “summer” on 2 products" }).click();
  await expect(recent.getByText("Undone", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Filter by tag" })).toHaveCount(0);
});
