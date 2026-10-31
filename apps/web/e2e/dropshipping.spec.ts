import { expect, test, type Page } from "@playwright/test";

// Milestone 2 "done when": imported products route to the supplier on payment, tracking flows back,
// and a supplier refusal shows up as a problem order the merchant can fix.

async function newMerchant(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`m2-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Gadget Den ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Gadget Den/ })).toBeVisible();
}

async function importDemo(page: Page, name: RegExp) {
  await page.goto("/admin/products");
  await page.getByRole("link", { name: "Import from supplier" }).first().click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByText("From Demo supplier")).toBeVisible();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const href = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  return href;
}

async function buy(page: Page, productUrl: string) {
  await page.goto(productUrl);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Check out" }).click();
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Full name").fill("Ada Buyer");
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or region").fill("TX");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  return page.url();
}

/** Routing runs just after the payment response, so give it a moment. */
async function reloadUntil(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 15_000 });
}

test("an imported product's order goes to the supplier and tracking reaches the buyer", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  const productUrl = await importDemo(page, /sunset projection lamp/i);

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const statusUrl = await buy(buyer, productUrl);

  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await reloadUntil(page, () => expect(page.getByText(/Supplier order DEMO-/)).toBeVisible({ timeout: 1000 }));
  await expect(page.getByText(/Order confirmation email sent to ada@example.com/)).toBeVisible();

  // The demo supplier ships straight away; the scheduled job would find it, the button does it now.
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText(/Shipped with Demo Post/)).toBeVisible();
  await expect(page.getByText(/Shipping update email sent/)).toBeVisible();

  await buyer.goto(statusUrl);
  await expect(buyer.getByRole("heading", { name: "Tracking" })).toBeVisible();
  await expect(buyer.getByText(/Demo Post: DS\d+/)).toBeVisible();
});

test("a supplier refusal becomes a problem order the merchant fixes by shipping it themselves", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  const productUrl = await importDemo(page, /galaxy projector low stock/i);

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const statusUrl = await buy(buyer, productUrl);

  await page.goto("/admin");
  await reloadUntil(page, () => expect(page.getByText(/1 order needs you/)).toBeVisible({ timeout: 1000 }));
  await page.getByRole("link", { name: /1 order needs you/ }).click();
  await expect(page).toHaveURL(/show=problems/);
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(page.getByRole("heading", { name: "The supplier couldn't take this order" })).toBeVisible();
  await expect(page.getByText("The supplier is out of stock for an item in this order.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Still failing/)).toBeVisible();

  await page.getByRole("button", { name: "Add tracking yourself" }).first().click();
  await page.getByLabel("Carrier").fill("USPS");
  await page.getByLabel("Tracking number").fill("9400111899223");
  await page.getByRole("button", { name: "Mark as shipped" }).click();
  await expect(page.getByRole("heading", { name: "The supplier couldn't take this order" })).toBeHidden();
  await expect(page.getByText("Shipped", { exact: true })).toBeVisible();

  await buyer.goto(statusUrl);
  await expect(buyer.getByText("USPS: 9400111899223")).toBeVisible();

  // Shipped today, so it isn't past its delivery date.
  await page.goto("/admin/orders");
  await expect(page.getByRole("link", { name: "#1001" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Past their delivery date/ })).toHaveCount(0);
});
