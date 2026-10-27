import { expect, test } from "@playwright/test";

// Barcodes: the merchant gives an option a barcode, prints labels for what's on the shelf, and on
// the stock count each scan adds one to that option's count.

test("barcode labels and scanning on the stock count", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Candles ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Candles/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Fig Candle");
  await page.getByLabel("Price", { exact: true }).fill("18.00");
  await page.getByLabel("Stock", { exact: true }).fill("3");
  await page.getByLabel("SKU", { exact: true }).fill("FIG-01");
  await page.getByLabel("Barcode", { exact: true }).fill("012345678905");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  await page.getByRole("link", { name: "Print labels" }).click();
  await expect(page.getByRole("heading", { name: "Labels for Fig Candle" })).toBeVisible();
  const labels = page.getByRole("list", { name: "Labels" }).getByRole("listitem");
  await expect(labels).toHaveCount(3);
  await expect(labels.first().getByRole("img", { name: "Barcode 012345678905" })).toBeVisible();
  await expect(labels.first()).toContainText("$18.00");
  await page.getByLabel("Number of labels").fill("5");
  await page.getByRole("button", { name: "Update" }).click();
  await expect(labels).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Print 5 labels" })).toBeVisible();

  await page.goto("/admin/inventory/count");
  const scan = page.getByLabel("Scan a barcode");
  await scan.fill("012345678905");
  await scan.press("Enter");
  await scan.fill("fig-01");
  await scan.press("Enter");
  await expect(page.getByText("Fig Candle: 2")).toBeVisible();
  await expect(page.getByLabel("Counted Fig Candle")).toHaveValue("2");
  await scan.fill("NOPE");
  await scan.press("Enter");
  await expect(page.getByText("No option has the barcode or SKU NOPE.")).toBeVisible();
  await page.getByRole("button", { name: "Save count" }).click();
  await expect(page.getByText("Updated 1 option.")).toBeVisible();
});
