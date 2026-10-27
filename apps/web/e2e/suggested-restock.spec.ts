import { expect, test } from "@playwright/test";

// Suggested restock: the new restock order is filled in with enough to last the next 30, 60 or
// 90 days at the pace things sold in the last 30.

test("a restock order filled in from what sold", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Roses ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Roses/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Rose Soap");
  await page.getByLabel("Price", { exact: true }).fill("7.00");
  await page.getByLabel("Stock", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const soap = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(soap);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`sr-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/inventory");
  await page.getByRole("link", { name: "Suggest a restock" }).click();
  const note = page.getByRole("region", { name: "Suggested amounts" });
  await expect(note).toContainText("enough for the next 30 days");
  await expect(page.getByLabel("How many Rose Soap")).toHaveValue("1");
  await note.getByRole("link", { name: "Enough for 90 days" }).click();
  await expect(page.getByLabel("How many Rose Soap")).toHaveValue("3");
  await page.getByLabel("Ordered from").fill("Petal Supply");
  await page.getByRole("button", { name: "Save restock order" }).click();
  await expect(page.getByRole("heading", { name: "Restock #1" })).toBeVisible();
});
