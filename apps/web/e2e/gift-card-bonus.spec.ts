import { expect, test } from "@playwright/test";

// Gift card bonus: the merchant offers a $10 bonus card for every $50 in gift cards, usable from
// a later date. The gift card's page says so, the buyer gets the bonus card by email, and it can't
// be spent before its day.

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("a buyer gets a bonus card with gift cards, usable from a later day", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bonus-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bonus ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bonus/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.split("/products/")[0];

  await page.goto("/admin/gift-cards");
  await page.getByLabel(/^Amounts/).fill("25, 50");
  await page.getByRole("button", { name: "Start selling gift cards" }).click();
  await expect(page.getByRole("link", { name: "Gift card product" })).toBeVisible();
  const bonus = page.getByRole("region", { name: "Bonus card with gift cards" });
  await bonus.getByLabel("Bonus card ($)").fill("10");
  await bonus.getByLabel("For every ($ in gift cards)").fill("50");
  await bonus.getByLabel("Bought from").fill(day(-1));
  await bonus.getByLabel("Bought until").fill(day(3));
  await bonus.getByLabel("Bonus usable from (optional)").fill(day(30));
  // The bonus has to outlast the offer.
  await bonus.getByLabel("Bonus expires after (optional)").fill(day(2));
  await bonus.getByRole("button", { name: "Start the bonus" }).click();
  await expect(bonus.getByRole("alert")).toHaveText("Bonus cards have to stay usable after the offer's last day.");
  await bonus.getByLabel("Bonus expires after (optional)").fill(day(60));
  await bonus.getByRole("button", { name: "Start the bonus" }).click();
  await expect(bonus.getByLabel("Bonus offer")).toContainText("On now$10.00 for every $50.00");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const email = `bonus-buyer-${id}@example.com`;
  await buyer.goto(`${store}/products/gift-card`);
  await expect(buyer.locator("#gift-card-bonus")).toContainText("Get a $10.00 bonus card for every $50.00 in gift cards, until");
  await expect(buyer.locator("#gift-card-bonus")).toContainText("You can use the bonus card from");
  await buyer.getByText("$50.00", { exact: true }).first().click();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: "Pay $50.00" }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: email }).filter({ hasText: "Your $10.00 bonus card for" }).first();
  await expect(mail).toContainText("You can use it from");
  const code = (await mail.textContent())!.match(/Gift card code: ([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/)![1]!;
  await inbox.close();

  await page.goto("/admin/gift-cards");
  const card = page.getByRole("listitem", { name: `Gift card ending ${code.slice(-4)}` });
  await expect(card).toContainText("Bonus with order #1001");
  await expect(card).toContainText("Usable from");

  // The balance page says from when it can be spent.
  await buyer.goto(`${store}/gift-cards`);
  await buyer.getByLabel("Gift card code").fill(code);
  await buyer.getByRole("button", { name: /check/i }).click();
  await expect(buyer.getByText(/\$10\.00 left of \$10\.00 It can be used from/)).toBeVisible();
});
