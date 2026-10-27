import { expect, test } from "@playwright/test";

// The order list's bulk bar: tick several orders, then tag them, take a tag off, or print just
// their packing slips.

test("tag several orders at once and print their packing slips", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bulk-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bulk ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bulk/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  for (const name of ["Ada Lovelace", "Grace Hopper"]) {
    await buyer.goto(lamp);
    await buyer.getByRole("button", { name: "Add to cart" }).click();
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).fill(`b-${name.split(" ")[0]}-${id}@example.com`);
    await buyer.getByLabel("Full name").fill(name);
    await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
    await buyer.getByRole("button", { name: /^Pay/ }).click();
    await expect(buyer.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
  }

  await page.goto("/admin/orders");
  await page.getByRole("checkbox", { name: "Pick all orders shown" }).check();
  await expect(page.getByRole("checkbox", { name: "Pick order #1002" })).toBeChecked();
  await page.getByLabel("Tag for the picked orders").fill("Rush");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByRole("status")).toHaveText("Tagged 2 orders “rush”.");
  await page.getByRole("navigation", { name: "Filter by tag" }).getByRole("link", { name: /rush/ }).click();
  await expect(page.getByRole("checkbox", { name: /Pick order/ })).toHaveCount(2);

  await page.getByRole("checkbox", { name: "Pick order #1001" }).check();
  await page.getByLabel("Tag for the picked orders").fill("rush");
  await page.getByRole("button", { name: "Remove tag" }).click();
  await expect(page.getByRole("status")).toHaveText("Took “rush” off 1 order.");
  // Still on the rush filter.
  await expect(page.getByRole("checkbox", { name: /Pick order/ })).toHaveCount(1);

  await page.getByRole("checkbox", { name: "Pick order #1002" }).check();
  await page.getByRole("button", { name: "Packing slips" }).click();
  await expect(page.getByRole("heading", { name: "Packing slips" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Packing slip for order #1002" })).toContainText("Grace Hopper");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Print 1 packing slip" })).toBeVisible();
});
