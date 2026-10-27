import { expect, test } from "@playwright/test";

// Packing slips: the merchant prints a slip for the orders waiting to ship, with the ship-to
// address and what goes in the box but no prices, and their own note at the foot.

test("packing slips for the orders waiting to ship", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ps-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Slips ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Slips/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/orders/packing-slips");
  await expect(page.getByText("No orders are waiting to ship.")).toBeVisible();
  await page.getByText("Note at the foot of every slip").click();
  await page.getByLabel("Slip note").fill("Thanks for your order! Use THANKS10 next time.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`slip-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "Packing slips" }).click();
  await expect(page.getByRole("button", { name: "Print 1 packing slip" })).toBeVisible();
  const slip = page.getByRole("article", { name: "Packing slip for order #1001" });
  await expect(slip.getByRole("region", { name: "Ship to" })).toContainText("Ada Lovelace");
  await expect(slip.getByRole("region", { name: "Ship to" })).toContainText("United States");
  await expect(slip.getByRole("cell", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await expect(slip).toContainText("Thanks for your order! Use THANKS10 next time.");
  await expect(slip).not.toContainText("$");

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await page.getByRole("link", { name: "Packing slip", exact: true }).click();
  await expect(page.getByRole("article", { name: "Packing slip for order #1001" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print packing slip" })).toBeVisible();
});
