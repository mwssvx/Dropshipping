import { expect, test, type Page } from "@playwright/test";

// Supplier scorecard: the Suppliers page shows how each supplier has done with the store's orders.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the Suppliers page scores each supplier on recent orders", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Score ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Score/ })).toBeVisible();

  // No orders yet: nothing to score.
  await page.goto("/admin/suppliers");
  await expect(page.getByRole("heading", { name: "How your suppliers are doing" })).toHaveCount(0);

  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // One order with the demo supplier: counted, but too few to grade.
  await page.goto("/admin/suppliers");
  const card = page.getByRole("region", { name: "How your suppliers are doing" });
  const row = card.getByRole("row").filter({ hasText: "Demo supplier" });
  await expect(row.getByRole("cell").nth(1)).toHaveText("1");
  await expect(row.getByRole("cell").nth(2)).toHaveText("0 (0%)");
  await expect(row).toContainText("Too few orders");
  await shot(page, "341-supplier-scores");
});
