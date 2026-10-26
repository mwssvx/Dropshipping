import { expect, test } from "@playwright/test";

// Partners: a creator gets their own code and share link; orders paid with it show on the
// Partners page and on the partner's private page. Payouts and refunds are covered by the core tests.

test("a partner's link brings an order, and they see it on their own page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pt-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Partner ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Partner/ })).toBeVisible();

  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.getByRole("link", { name: "Partners" }).first().click();
  await expect(page.getByText("No partners yet.")).toBeVisible();
  await page.getByLabel("Name").fill("Maya Creates");
  await page.getByLabel("Their code").fill("maya15");
  await page.getByLabel("Buyers get (% off)").fill("15");
  await page.getByLabel("They get (% of the items)").fill("10");
  await page.getByRole("button", { name: "Add partner" }).click();
  await expect(page.getByText("Maya Creates is set up.")).toBeVisible();
  const card = page.getByRole("article", { name: "Maya Creates" });
  await expect(card).toContainText("Code MAYA15 · buyers get 15% off · they get 10%");
  const share = await card.getByLabel("Share link (applies the code)").inputValue();
  const portal = await card.getByLabel("Their private page").inputValue();
  expect(share).toMatch(/\/discount\/MAYA15$/);

  // A buyer opens the link: the code is already in their cart.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  // ?to= lands them on a product instead of the home page.
  await buyer.goto(`${share}?to=/products/${product.split("/products/")[1]}`);
  await expect(buyer.getByRole("heading", { name: "Sunset Projection Lamp" })).toBeVisible();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByText("Discount (MAYA15)")).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.reload();
  await expect(card.getByText("Orders").locator("..")).toContainText("1");

  // The partner's page: their numbers, no buyer details.
  const partner = await (await browser.newContext({ ...info.project.use })).newPage();
  await partner.goto(portal);
  await expect(partner.getByRole("heading", { name: `Your earnings with Partner ${id}` })).toBeVisible();
  await expect(partner.getByText("Waiting to count").last()).toBeVisible();
  await expect(partner.getByRole("table")).toBeVisible();
  await expect(partner.getByText("ada@example.com")).toHaveCount(0);
  await expect(partner.getByText("Ada Buyer")).toHaveCount(0);

  // Paused: the partner is told, and the code no longer works.
  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card.getByText("Paused")).toBeVisible();
  await partner.reload();
  await expect(partner.getByText(/has paused your code/)).toBeVisible();
});
