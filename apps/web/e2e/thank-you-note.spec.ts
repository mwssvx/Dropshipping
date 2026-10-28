import { expect, test } from "@playwright/test";

// The thank-you note: the store's own words for buyers who just paid, on the order page and in the
// order confirmation email.

test("buyers see the store's thank-you note after paying", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`tyn-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Thanks ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Thanks/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/marketing");
  await page.getByRole("textbox", { name: "Thank-you note" }).fill("Follow us on Instagram @glowlamps for new colours.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByRole("region", { name: "Thank-you note" }).getByRole("status")).toHaveText("Saved.");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const email = `tyn-buyer-${id}@example.com`;
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByRole("region", { name: /A note from Thanks/ })).toHaveText("Follow us on Instagram @glowlamps for new colours.");

  await page.goto("/dev/mail");
  await expect(page.getByRole("article").filter({ hasText: email }).filter({ hasText: "confirmed" }).filter({ hasText: "@glowlamps" })).toBeVisible();
});
