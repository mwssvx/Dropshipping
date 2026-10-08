import { expect, test, type Page } from "@playwright/test";

// Milestone 4 (part 1) "done when": a merchant sets up payouts, sees what each sale nets after
// fees, gets paid out, can clear a payout hold by sending a document, refunds an order, and
// switches plans. Set SCREENSHOTS_DIR to also save the screens for review.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchant(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`m4-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Cozy Corner ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Cozy Corner/ })).toBeVisible();
}

async function importDemo(page: Page) {
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
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
}

test("payouts, holds, refunds and plans", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  const productUrl = await importDemo(page);

  // Set up payouts (test mode connects at once and comes straight back).
  await page.getByRole("link", { name: "Money" }).first().click();
  await shot(page, "33-money-setup");
  await page.getByRole("button", { name: "Set up payouts" }).click();
  await expect(page.getByText("Payouts are set up.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buy(buyer, productUrl);

  // The sale shows as clearing, with our 2% fee and the card fee taken off.
  await page.reload();
  const balance = page.getByRole("region", { name: "Balance" });
  await expect(balance.getByText("Clearing")).toBeVisible();
  await expect(page.getByText(/Our fee \(2% on the Free plan\)/)).toBeVisible();
  await page.getByRole("button", { name: "Pay out now" }).click();
  await expect(page.getByRole("cell", { name: "On the way" })).toBeVisible();
  await shot(page, "34-money-balance");

  // A hold: the card says why and what to send; sending it releases payouts.
  await page.getByLabel("Hold reason").selectOption("identity_document");
  await page.getByRole("button", { name: "Simulate a payout hold" }).click();
  await expect(page.getByRole("heading", { name: "Payouts paused: Photo ID needed" })).toBeVisible();
  await expect(page.getByText(/Card networks require every seller to prove who they are/)).toBeVisible();
  await shot(page, "35-money-hold");
  await page.getByLabel("Upload your photo id").setInputFiles({ name: "passport.png", mimeType: "image/png", buffer: Buffer.from("fake png") });
  await page.getByRole("button", { name: "Send document" }).click();
  await expect(page.getByRole("heading", { name: /Payouts paused/ })).toHaveCount(0);

  // Refund the order. The demo supplier ships at once, so the merchant is told it couldn't be stopped.
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).click();
  await expect(page.getByText("You receive")).toBeVisible();
  await page.getByRole("button", { name: "Refund" }).click();
  await page.getByLabel("Reason").fill("Changed their mind");
  await shot(page, "36-order-refund");
  await page.getByRole("button", { name: "Refund" }).last().click();
  await expect(page.getByText(/Refunded in full\. .*We emailed the customer\./)).toBeVisible();
  await expect(page.getByText(/Couldn't stop the supplier order: The supplier already shipped it\./)).toBeVisible();
  await shot(page, "37-order-refunded");
  await expect(page.getByText(/Refunded \$[\d.]+: Changed their mind/)).toBeVisible();
  await expect(page.getByText("Refunded", { exact: true }).first()).toBeVisible();

  // Switch plans: no sales fee on Growth.
  await page.goto("/admin/plan");
  await expect(page.getByRole("heading", { name: "You're on Free" })).toBeVisible();
  await shot(page, "38-plan");
  await page.getByRole("button", { name: "Upgrade to Growth" }).click();
  await expect(page.getByRole("heading", { name: "You're on Growth" })).toBeVisible();
});

test("the statement downloads as CSV", async ({ page }, info) => {
  await newMerchant(page, `${info.project.name}-csv-${Date.now()}`);
  const res = await page.request.get("/admin/money/statement");
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toMatch(/^date,type,reference,amount \(USD\)/);
});
