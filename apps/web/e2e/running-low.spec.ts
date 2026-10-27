import { expect, test } from "@playwright/test";

// Running low: the Products page lists options of the store's own stock at or under its number,
// and the merchant picks the number.

test("own stock running low shows on the Products page", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rl-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Low ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Low/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Linen Shirt");
  await page.getByLabel("Price", { exact: true }).fill("30.00");
  await page.getByLabel("Stock", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  await page.goto("/admin/products");
  const low = page.getByRole("list", { name: "Running low" });
  await expect(low.getByRole("listitem")).toHaveText(["Linen Shirt2 left"]);
  await page.getByLabel("Email me at").fill("1");
  await page.getByRole("region", { name: "Running-low email" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. We email you when an option has 1 or fewer left.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Running low" })).toHaveCount(0);
  await expect(page.getByLabel("Email me at")).toHaveValue("1");
});
