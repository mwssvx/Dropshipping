import { expect, test } from "@playwright/test";

// Supplier warehouses: a listing sold from China and the US comes in from one of them, picked at
// import, without a "Ships from" choice for buyers. Abroad, the product page says where it ships from.

test("the merchant picks which warehouse to sell from", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`wh-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Fans ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Fans/ })).toBeVisible();

  await page.goto(`/admin/products/import?url=${encodeURIComponent("https://demo-supplier.test/p/desk-fan-warehouses")}`);
  const picker = page.getByRole("region", { name: "Pick a warehouse" });
  const warehouses = picker.getByRole("list", { name: "Warehouses" });
  await expect(warehouses.getByRole("link")).toHaveCount(2);
  // A US store starts on the US warehouse.
  await expect(warehouses.getByRole("link", { name: /^United States/ })).toHaveAttribute("aria-current", "true");
  await expect(picker.getByRole("note")).toHaveCount(0);
  await expect(page.getByText(/ships in 3–5 days/)).toBeVisible();

  await warehouses.getByRole("link", { name: /^China/ }).click();
  await expect(warehouses.getByRole("link", { name: /^China/ })).toHaveAttribute("aria-current", "true");
  await expect(picker.getByRole("note")).toContainText('It\'ll show "Ships from China" on the product page');
  await expect(page.getByText(/ships in 8–15 days/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /China|Ships From/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Customs" }).getByRole("note")).toHaveText("Ships from China.");
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  await page.goto(store);
  await expect(page.locator("#ships-from")).toHaveText("Ships from China");
});
