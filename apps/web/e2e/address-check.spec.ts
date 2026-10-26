import { expect, test } from "@playwright/test";

// Address check: checkout asks the buyer to fix a postal code in the wrong shape or a missing
// state before they pay, and tidies what it can.

test("checkout asks for a real postal code and state, and tidies them", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ac-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Parcels ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Parcels/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`ac-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("Postal code").fill("7870");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Check the postal code. In the United States it looks like 78701.")).toBeVisible();
  await buyer.getByLabel("Postal code").fill("78701 1234");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Enter the state, like TX or Texas.")).toBeVisible();
  await buyer.getByLabel("State or region").fill("texas");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.locator("address").first()).toContainText("TX");
  await expect(page.locator("address").first()).toContainText("78701-1234");
});
