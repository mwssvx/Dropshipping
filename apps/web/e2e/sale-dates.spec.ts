import { expect, test } from "@playwright/test";

// Dates coming up: the Sales page lists the next shopping dates for the store's country (Black
// Friday, Boxing Day...), fills in the sale form for one, and marks it planned once there's a sale.

test("a merchant plans a sale for a date coming up", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`dates-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Dates ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Dates/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/sales");
  const ahead = page.getByRole("region", { name: "Dates coming up" });
  // Whatever comes next on the calendar when this runs.
  const first = ahead.getByRole("listitem").first();
  const name = (await first.getAttribute("aria-label"))!;
  await first.getByRole("link", { name: "Plan a sale" }).click();
  await expect(page).toHaveURL(/plan=/);
  await expect(page.getByText(`Filled in for ${name}.`)).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue(/sale$/);
  await expect(page.getByLabel("Ends")).not.toHaveValue("");
  await page.getByLabel("Discount (%)").fill("15");
  await page.getByRole("button", { name: "Add sale" }).click();
  // The form empties and the date shows the new sale.
  await expect(ahead.getByRole("listitem", { name })).toContainText("Planned:");
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByRole("listitem", { name: /sale$/ }).last()).toContainText("15% off");
});
