import { expect, test } from "@playwright/test";

// Inventory: the store's own stock in one list, with what it's worth, and as a spreadsheet.

test("the inventory page totals the store's own stock and downloads it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`inv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Candles ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Candles/ })).toBeVisible();

  await page.goto("/admin/inventory");
  await expect(page.getByText("Nothing counted yet.")).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Beeswax Candle");
  await page.getByLabel("Price", { exact: true }).fill("12.00");
  await page.getByLabel("Your cost").fill("4.00");
  await page.getByLabel("Stock", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  await page.getByRole("link", { name: "Inventory", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  const totals = page.getByRole("region", { name: "Totals" });
  await expect(totals).toContainText("Worth at cost$12.00");
  await expect(totals).toContainText("Worth at your prices$36.00");
  await expect(page.getByRole("row", { name: "Beeswax Candle" })).toContainText("Running low");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download spreadsheet" }).click();
  const file = await (await download).path();
  const { readFile } = await import("node:fs/promises");
  expect(await readFile(file!, "utf8")).toContain("Beeswax Candle,,,3,0,4.00,12.00,12.00,36.00,0,");
});
