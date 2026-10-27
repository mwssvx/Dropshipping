import { expect, test } from "@playwright/test";

// Stock count: the merchant counts the shelf, types what's there, and the differences go in.

test("a stock count fixes the numbers and says what went missing", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Soaps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Soaps/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Olive Soap");
  await page.getByLabel("Price", { exact: true }).fill("6.00");
  await page.getByLabel("Your cost").fill("1.50");
  await page.getByLabel("Stock", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const product = page.url().split("?")[0]!;

  await page.goto("/admin/inventory");
  await page.getByRole("link", { name: "Count stock" }).click();
  await expect(page.getByRole("heading", { name: "Count stock" })).toBeVisible();
  await page.getByLabel("Counted Olive Soap").fill("17");
  await page.getByRole("button", { name: "Save count" }).click();
  await expect(page.getByText("Updated 1 option. 3 fewer than expected, worth $4.50 at cost.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Olive Soap/ })).toContainText("17");

  await page.goto(product);
  await expect(page.getByLabel("Stock", { exact: true })).toHaveValue("17");
  await page.getByText("Stock history").click();
  await expect(page.getByRole("cell", { name: "Stock count" })).toBeVisible();
});
