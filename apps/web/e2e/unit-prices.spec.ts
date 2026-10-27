import { expect, test } from "@playwright/test";

// Price per unit: the merchant says what one holds and the store shows the price per 100 g, kg,
// litre or item under the price.

test("a product sold by weight shows its price per 100 g", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`up-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Beans ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Beans/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("House Blend Coffee");
  await page.getByLabel("Price", { exact: true }).fill("6.00");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Price per unit" }) });
  await panel.getByLabel("Pack contents").fill("lots");
  await panel.getByRole("button", { name: "Save price per unit" }).click();
  await expect(panel.getByText("should be a number above 0")).toBeVisible();
  await panel.getByLabel("Pack contents").fill("250");
  await panel.getByLabel("Pack unit").selectOption("g");
  await panel.getByRole("button", { name: "Save price per unit" }).click();
  await expect(page.getByText("Saved. The price per unit shows under the price on the store.")).toBeVisible();
  await page.reload();
  await expect(panel.getByText("$2.40 / 100 g")).toBeVisible();

  await page.goto(store);
  await expect(page.locator("main").getByText("$2.40 / 100 g").first()).toBeVisible();
  await page.goto(store.replace(/\/products\/.*$/, "/collections/all"));
  await expect(page.getByText("$2.40 / 100 g")).toBeVisible();
});
