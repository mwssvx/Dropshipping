import { expect, test } from "@playwright/test";

// What your own stock costs you, set on many products at once for the profit report. Supplier
// products keep the supplier's cost.

test("a merchant sets the cost of their own products in one go", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bulk cost ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bulk cost/ })).toBeVisible();
  for (const [title, price] of [["Beeswax Candle", "20.00"], ["Linen Napkins", "15.00"]]) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title!);
    await page.getByLabel("Price", { exact: true }).fill(price!);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/products");
  // The two of the store's own have no cost yet; the lamp has the supplier's.
  const missing = page.getByRole("navigation", { name: "Filter by what's missing" });
  await expect(missing.getByRole("link", { name: "No cost 2" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all products" }).check();
  await page.getByLabel("Change", { exact: true }).selectOption({ label: "Set what your own stock costs" });
  await page.getByLabel("What each costs you (% of its price)").fill("40");
  await page.getByRole("button", { name: "Preview" }).click();
  const table = page.getByRole("table", { name: "What will change" });
  await expect(table.getByRole("row", { name: /Beeswax Candle/ })).toContainText("costs $8.00");
  await expect(table.getByRole("row", { name: /Linen Napkins/ })).toContainText("costs $6.00");
  await expect(table.getByRole("row", { name: /Sunset Projection Lamp/ })).toHaveCount(0);
  await expect(page.getByText("Supplier products keep the supplier's cost, and gift cards have none (1 skipped).")).toBeVisible();
  await page.getByRole("button", { name: "Apply to 2 products" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Set the cost to 40% of the price where it was missing on 2 products." })).toBeVisible();

  await page.reload();
  await expect(missing.getByRole("link", { name: /^No cost/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Beeswax Candle" }).first().click();
  await expect(page.getByLabel("Your cost").first()).toHaveValue("8.00");
});
