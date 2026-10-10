import { expect, test, type Page } from "@playwright/test";

// Bulk edit: tick products on the Products page, preview a change, apply it, and undo it.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant changes prices on many products at once, then undoes it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bu-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bulk ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bulk/ })).toBeVisible();
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  }

  await page.goto("/admin/products");
  // Rows of the products table (the preview table has rows for the same products).
  const row = (name: RegExp) => page.getByRole("row", { name: new RegExp(`^Select ${name.source}`) });
  const price = async (name: RegExp) => Number((await row(name).getByRole("cell").nth(3).textContent())!.replace(/[^\d.]/g, ""));
  const lamp = await price(/Sunset Projection Lamp/);
  const stand = await price(/Magnetic Phone Stand/);

  await page.getByRole("checkbox", { name: "Select all products" }).check();
  await expect(page.getByText("2 products selected")).toBeVisible();
  await page.getByLabel("Change", { exact: true }).selectOption({ label: "Change prices by a percent" });
  await page.getByLabel("By percent (minus to lower)").fill("10");
  await page.getByLabel("Round to").selectOption({ label: ".99" });
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("table", { name: "What will change" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("row", { name: /Sunset Projection Lamp/ }).first()).toBeVisible();
  await shot(page, "181-bulk-preview");
  await page.getByRole("button", { name: "Apply to 2 products" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Raised prices 10% on 2 products." })).toBeVisible();
  await expect.poll(() => price(/Sunset Projection Lamp/)).toBe(Math.round(lamp * 1.1) - 0.01);
  expect(await price(/Magnetic Phone Stand/)).toBe(Math.round(stand * 1.1) - 0.01);

  // Selling under cost needs a tick.
  await page.getByRole("checkbox", { name: "Select Magnetic Phone Stand" }).uncheck();
  await page.getByLabel("By percent (minus to lower)").fill("-90");
  await page.getByLabel("Round to").selectOption({ label: "Don't round" });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Below cost").first()).toBeVisible();
  await page.getByRole("button", { name: "Apply to 1 product" }).click();
  await expect(page.getByText(/for less than the supplier charges you/)).toBeVisible();
  expect(await price(/Sunset Projection Lamp/)).toBe(Math.round(lamp * 1.1) - 0.01);

  // Undo the price rise from the recent changes.
  const recent = page.getByRole("region", { name: "Recent changes" });
  await recent.getByRole("button", { name: "Undo: Raised prices 10% on 2 products" }).click();
  await expect(recent.getByText("Undone", { exact: true })).toBeVisible();
  await expect.poll(() => price(/Sunset Projection Lamp/)).toBe(lamp);
  expect(await price(/Magnetic Phone Stand/)).toBe(stand);
  await shot(page, "182-bulk-undone");

  // Hide both from the store.
  await page.getByRole("checkbox", { name: "Select all products" }).check();
  await page.getByLabel("Change", { exact: true }).selectOption({ label: "Hide from the store (draft)" });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Apply to 2 products" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Hid on 2 products." })).toBeVisible();
  await expect(row(/Sunset Projection Lamp/).getByText("Draft")).toBeVisible();
});
