import { expect, test, type Page } from "@playwright/test";

// Milestone 4 (part 2) "done when": a registered store charges the right tax at checkout, and a
// store gets a warning before a pause, sees why, appeals, and is reopened by staff.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
}

async function newMerchant(page: Page, id: string) {
  await signUp(page, `m4b-${id}@example.com`);
  await page.getByLabel("Store name").fill(`Tidy Desk ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Tidy Desk/ })).toBeVisible();
}

test("a registered store adds sales tax at checkout", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  const productUrl = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.getByRole("link", { name: "Taxes" }).first().click();
  await expect(page.getByText("None yet, so no tax is charged on any order.")).toBeVisible();
  await page.getByLabel("Where you're registered").selectOption("US-TX");
  await page.getByRole("button", { name: "Add registration" }).click();
  await expect(page.getByText("Texas (sales tax)")).toBeVisible();
  await shot(page, "39-taxes");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(productUrl);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByText("Total before tax")).toBeVisible();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("Texas");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Sales tax (TX) 6.25%")).toBeVisible();
  await shot(buyer, "40-pay-with-tax");
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("cell", { name: /Sales tax \(TX\)/ })).toBeVisible();
});

test("warning, pause, appeal and reopen", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  const storeName = `Tidy Desk ${id}`;

  // Staff (listed in STAFF_EMAILS for the test server) find the store and warn it.
  const staff = await (await browser.newContext({ ...info.project.use })).newPage();
  await signUp(staff, `staff-${info.project.name}@example.com`);
  await expect(staff.getByLabel("Store name")).toBeVisible();
  await staff.goto("/staff");
  await staff.getByRole("link", { name: storeName }).click();
  await staff.getByLabel("Reason").selectOption("late_shipping");
  await staff.getByLabel(/What happened/).fill("Four orders from last week still have no tracking after 10 days.");
  await staff.getByRole("button", { name: "Send notice" }).click();
  await expect(staff.getByText("Sent.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: /Orders are shipping late\. Fix it by/ })).toBeVisible();
  await shot(page, "41-warning-banner");

  // Pausing works now that there was a warning.
  await staff.getByLabel("Type").selectOption("paused");
  await staff.getByLabel(/What happened/).fill("The late orders weren't shipped or refunded by the deadline.");
  await staff.getByRole("button", { name: "Send notice" }).click();
  await expect(staff.getByText("Sent.")).toBeVisible();

  await page.reload();
  await page.getByRole("link", { name: /Your store is paused/ }).click();
  await expect(page.getByRole("heading", { name: "Orders are shipping late" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Appeal", exact: true }).click();
  await page.getByLabel(/What you changed/).fill("All four orders were refunded and I moved those items to a faster supplier.");
  await page.getByRole("button", { name: "Send appeal" }).click();
  await expect(page.getByText(/A person reads every appeal/)).toBeVisible();
  await page.reload();
  await shot(page, "42-trust-paused");

  await staff.goto("/staff");
  await shot(staff, "43-staff-appeals");
  const appeal = staff.getByRole("article").filter({ hasText: storeName });
  await appeal.getByLabel("Reply to the merchant").fill("Thanks, confirmed the refunds. Reopened.");
  await appeal.getByRole("button", { name: "Accept" }).click();
  await expect(appeal).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("link", { name: /Your store is paused/ })).toHaveCount(0);
  await expect(page.getByText("Accepted:", { exact: false })).toHaveCount(0); // closed notices move to history
  await expect(page.getByRole("heading", { name: "Verified store badge" })).toBeVisible();
  await shot(page, "44-trust-reopened");
});

test("staff pages are hidden from merchants", async ({ page }, info) => {
  await newMerchant(page, `${info.project.name}-hidden-${Date.now()}`);
  const res = await page.goto("/staff");
  expect(res?.status()).toBe(404);
});
