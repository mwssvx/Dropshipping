import { expect, test, type Page } from "@playwright/test";

// A gift card bought for someone else: the code goes to them by email, with a message, today or
// on the day the buyer picked. The buyer hears where it went; the store sees when it goes out.

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`gc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Present ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Present/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
}

async function fillCheckout(buyer: Page, email: string) {
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
}

test("a buyer sends a gift card to a friend on a day they pick", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const lamp = await newMerchantWithLamp(page, `to-${id}`);
  const store = lamp.replace(/\/products\/.*$/, "");
  await page.goto("/admin/gift-cards");
  await page.getByLabel(/^Amounts/).fill("25, 50");
  await page.getByRole("button", { name: "Start selling gift cards" }).click();
  await expect(page.getByRole("link", { name: "Gift card product" })).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const email = `gc-giver-${id}@example.com`;
  const friend = `gc-friend-${id}@example.com`;
  await buyer.goto(`${store}/products/gift-card`);
  await buyer.getByText("$25.00", { exact: true }).first().click();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await fillCheckout(buyer, email);
  await expect(buyer.getByLabel("Their email")).toBeHidden();
  await buyer.getByLabel("Send the gift card to someone").check();
  await buyer.getByLabel("Their email").fill(friend);
  await buyer.getByLabel("Their name (optional)").fill("Sam");
  await buyer.getByLabel("From (your name)").fill("Ada");
  await buyer.getByLabel("Message (optional)").fill("Happy birthday!");
  const sendOn = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await buyer.getByLabel("Send on (optional)").fill(sendOn);
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: "Pay $25.00" }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // The buyer hears when it goes out; the friend gets nothing yet.
  await page.goto("/dev/mail");
  await expect(page.getByRole("article").filter({ hasText: email }).filter({ hasText: `will be emailed to ${friend} on` })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: friend }).filter({ hasText: "Gift card code" })).toHaveCount(0);

  // The store sees the card, waiting for its day.
  await page.goto("/admin/gift-cards");
  const day = new Date(`${sendOn}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  await expect(page.getByText(`${friend} · Bought on order`)).toBeVisible();
  await expect(page.getByText(`Sends on ${day}`)).toBeVisible();
});
