import { expect, test, type Page } from "@playwright/test";

// Tax-exempt buyers: the merchant records a reseller's exemption number on their customer page,
// and that buyer, signed in to their account, checks out with no tax. The number shows on the
// order for the merchant's records.

async function signIn(buyer: Page, store: string, email: string) {
  await buyer.goto(`${store}/account`);
  await buyer.getByLabel("Email").fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  await expect(buyer.getByRole("status")).toContainText("We sent a 6-digit code");
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const subject = await inbox.getByRole("article").filter({ hasText: email }).first().getByRole("heading").textContent();
  await inbox.close();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();
  await expect(buyer.getByText(`Signed in as ${email}`)).toBeVisible();
}

test("a signed-in tax-exempt buyer checks out with no tax", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`te-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Resale ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Resale/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const store = lamp.replace(/\/products\/.*$/, "");
  await page.goto("/admin/taxes");
  await page.getByLabel("Where you're registered").selectOption("US-TX");
  await page.getByRole("button", { name: "Add registration" }).click();
  await expect(page.getByRole("button", { name: "Add registration" })).toBeVisible();

  const email = `reseller-${id}@example.com`;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await signIn(buyer, store, email);

  await page.goto("/admin/customers");
  await page.getByRole("link", { name: email }).click();
  const exempt = page.getByRole("region", { name: "Tax exemption" });
  await exempt.getByRole("button", { name: "Make tax exempt" }).click();
  await expect(exempt.getByText("Enter their exemption certificate or resale number.")).toBeVisible();
  await exempt.getByLabel("Exemption certificate or resale number").fill("01-2345678");
  await exempt.getByRole("button", { name: "Make tax exempt" }).click();
  await expect(exempt.getByText("They pay no tax from now on.")).toBeVisible();
  await page.reload();
  await expect(exempt.getByLabel("Exemption certificate or resale number")).toHaveValue("01-2345678");
  await expect(exempt.getByRole("button", { name: "Remove exemption" })).toBeVisible();

  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByText("Tax exempt")).toBeVisible();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("01-2345678")).toBeVisible();
  await expect(buyer.getByText("Sales tax (TX)")).toHaveCount(0);
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByText("Tax (exempt, 01-2345678)")).toBeVisible();
});
