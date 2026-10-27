import { expect, test } from "@playwright/test";

// Colour dots: colour names fill themselves in, the merchant picks the rest, and the product page shows them.

test("a product's colours show as dots on the store", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sw-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Tees ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Tees/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Linen Tee");
  await page.getByLabel("Price", { exact: true }).fill("25.00");
  await page.getByRole("button", { name: "Add options like size or colour" }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Color");
  await page.getByLabel("Option 1 values, separated by commas").fill("Navy, Sage, Midnight");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const dots = page.getByRole("region", { name: "Color dots" });
  await expect(dots.getByRole("listitem").filter({ hasText: "Navy" }).getByText("From its name")).toBeVisible();
  await expect(dots.getByRole("listitem").filter({ hasText: "Midnight" }).getByText("Shown as words only")).toBeVisible();
  await dots.getByRole("button", { name: "Pick a colour for Midnight" }).click();
  await dots.getByLabel("Color Midnight").fill("#191970");
  await dots.getByRole("button", { name: "Save colours" }).click();
  await expect(dots.getByText("Saved. Buyers see these dots when they pick a color.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Color dots" }).getByLabel("Color Midnight")).toHaveValue("#191970");

  await page.goto(store);
  const color = page.getByRole("group", { name: /^Color:/ });
  await expect(color.locator("[data-swatch]")).toHaveCount(3);
  await expect(color.locator('[data-swatch="#1f2a4d"]')).toHaveCount(1);
  await expect(color.locator('[data-swatch="#191970"]')).toHaveCount(1);
  await color.getByText("Midnight", { exact: true }).click();
  await expect(color).toHaveAccessibleName("Color: Midnight");
});
