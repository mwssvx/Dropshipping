import { expect, test } from "@playwright/test";

// Reorder reminders: a product that runs out says how long it lasts, and turning it off again works.
// The email itself is covered by packages/core/test/reorder-reminders.test.ts.

test("a merchant sets how long a product lasts", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`reorder-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Beans ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Beans/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Morning Roast");
  await page.getByLabel("Price", { exact: true }).fill("14.00");
  await page.getByLabel("Stock", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  const section = page.getByRole("region", { name: "Reorder reminder" });
  await section.getByLabel("It usually lasts").selectOption("30");
  await section.getByRole("button", { name: "Save reminder" }).click();
  await expect(page.getByText("Buyers are reminded 30 days after it arrives.")).toBeVisible();

  await page.reload();
  await expect(section.getByLabel("It usually lasts")).toHaveValue("30");
  await section.getByLabel("It usually lasts").selectOption("");
  await section.getByRole("button", { name: "Save reminder" }).click();
  await expect(page.getByText("Buyers are reminded 30 days after it arrives.")).toHaveCount(0);
});
