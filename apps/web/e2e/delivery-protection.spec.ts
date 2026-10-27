import { expect, test } from "@playwright/test";

// Delivery protection: the merchant offers it on the Shipping page, the buyer chooses it at
// checkout (it's never ticked for them), and the order shows it's protected on both sides.

test("a buyer adds delivery protection at checkout, and the order shows it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`dp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Safe ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Safe/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  const protection = page.getByRole("region", { name: "Delivery protection" });
  await protection.getByLabel("Offer delivery protection at checkout").check();
  await protection.getByLabel("Charge (% of items)").fill("25");
  await protection.getByRole("button", { name: "Save protection" }).click();
  await expect(protection.getByText("Pick between 0.5% and 10% of the order.")).toBeVisible();
  await protection.getByLabel("Charge (% of items)").fill("3");
  await protection.getByLabel(/But no less than/).fill("2.50");
  await protection.getByRole("button", { name: "Save protection" }).click();
  await expect(protection.getByText("Saved. Buyers can add protection for 3% of their order.")).toBeVisible();
  await page.reload();
  await expect(protection.getByLabel(/But no less than/)).toHaveValue("2.50");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  const box = buyer.getByRole("checkbox", { name: /Protect my delivery for/ });
  await expect(box).not.toBeChecked();
  const summary = buyer.getByRole("complementary");
  const before = await summary.locator("dd").last().textContent();
  await box.check();
  await expect(summary.getByText("Delivery protection")).toBeVisible();
  await expect(summary.locator("dd").last()).not.toHaveText(before!);
  await buyer.getByRole("textbox", { name: "Email" }).fill(`dp-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Delivery protection")).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByText("Your delivery is protected.")).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByText("Protected delivery")).toBeVisible();
  await expect(page.getByText("Delivery protection", { exact: true })).toBeVisible();
});
