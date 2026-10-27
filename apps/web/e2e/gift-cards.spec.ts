import { expect, test, type Page } from "@playwright/test";

// Gift cards: the merchant sells them on the store or gives them as store credit. The code comes
// by email and goes in the cart's code box; it pays for all or part of an order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

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

async function codeFromInbox(page: Page, email: string, amount: string) {
  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  const text = await inbox.getByRole("article").filter({ hasText: email }).filter({ hasText: `Your ${amount} gift card for` }).first().textContent();
  await inbox.close();
  return text!.match(/Gift card code: ([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/)![1]!;
}

async function applyCode(buyer: Page, code: string) {
  await buyer.getByLabel("Discount or gift card code").fill(code);
  await buyer.getByRole("button", { name: "Apply" }).click();
}

test("a buyer buys a gift card, gets the code by email, and it pays for a whole order", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const lamp = await newMerchantWithLamp(page, id);
  const store = lamp.replace(/\/products\/.*$/, "");
  await page.goto("/admin/gift-cards");
  await page.getByLabel(/^Amounts/).fill("25, 50");
  await page.getByRole("button", { name: "Start selling gift cards" }).click();
  await expect(page.getByRole("link", { name: "Gift card product" })).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const email = `gc-buyer-${id}@example.com`;
  await buyer.goto(`${store}/products/gift-card`);
  await buyer.getByText("$50.00", { exact: true }).first().click();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.locator("dd").filter({ hasText: "Free" })).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await fillCheckout(buyer, email);
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: "Pay $50.00" }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const code = await codeFromInbox(page, email, "$50.00");

  // Spend it on a lamp: the gift card covers everything, so there's no card form.
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await applyCode(buyer, code.toLowerCase());
  await expect(buyer.getByText(`Gift card ···· ${code.slice(-4)}`).first()).toBeVisible();
  await expect(buyer.getByText("To pay")).toBeVisible();
  await expect(buyer.getByText(/stays on the card after this order/)).toBeVisible();
  await shot(buyer, "106-cart-gift-card");
  await buyer.getByRole("link", { name: "Check out" }).click();
  await fillCheckout(buyer, email);
  await buyer.getByRole("button", { name: "Place order" }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByText("Paid with gift card")).toBeVisible();

  await page.goto("/admin/gift-cards");
  const card = page.getByRole("listitem", { name: `Gift card ending ${code.slice(-4)}` });
  await expect(card).toContainText("Bought on order #1001");
  await expect(card).toContainText(/left of \$50\.00/);
  await shot(page, "105-gift-cards-admin");
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1002" }).first().getAttribute("href"))!);
  await expect(page.getByText(`Paid with gift card ···· ${code.slice(-4)}`)).toBeVisible();
});

test("store credit pays for part of an order, and a turned-off card stops working", async ({ page, browser }, info) => {
  const id = `${info.project.name}-sc-${Date.now()}`;
  const lamp = await newMerchantWithLamp(page, id);
  const email = `gc-credit-${id}@example.com`;
  await page.goto("/admin/gift-cards");
  await page.getByLabel("Send to").fill(email);
  await page.getByLabel("Amount", { exact: true }).fill("5");
  await page.getByLabel("Note in the email (optional)").fill("Sorry about the wait.");
  await page.getByRole("button", { name: "Send gift card" }).click();
  await expect(page.getByText("Gift card sent.")).toBeVisible();
  const code = await codeFromInbox(page, email, "$5.00");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await applyCode(buyer, code);
  await expect(buyer.getByText("$0.00 stays on the card after this order.")).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await fillCheckout(buyer, email);
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Gift card", { exact: true })).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByText("Paid by card")).toBeVisible();

  // Used up, then a new card turned off by the merchant: both are refused in the cart.
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await applyCode(buyer, code);
  await expect(buyer.locator("#code-error")).toContainText("used up");
  await page.goto("/admin/gift-cards");
  await page.getByLabel("Send to").fill(email);
  await page.getByLabel("Amount", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Send gift card" }).click();
  await expect(page.getByText("Gift card sent.")).toBeVisible();
  const second = await codeFromInbox(page, email, "$20.00");
  await page.getByRole("listitem", { name: `Gift card ending ${second.slice(-4)}` }).getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("listitem", { name: `Gift card ending ${second.slice(-4)}` })).toContainText("Turned off");
  await applyCode(buyer, second);
  await expect(buyer.locator("#code-error")).toContainText("turned off");
});

test("the merchant finds a gift card by the code a buyer reads out", async ({ page }, info) => {
  const id = `${info.project.name}-find-${Date.now()}`;
  await newMerchantWithLamp(page, id);
  await page.goto("/admin/gift-cards");
  const codes: string[] = [];
  for (const [who, amount] of [["ada", "10"], ["grace", "15"]] as const) {
    const email = `gc-${who}-${id}@example.com`;
    await page.getByLabel("Send to").fill(email);
    await page.getByLabel("Amount", { exact: true }).fill(amount);
    await page.getByRole("button", { name: "Send gift card" }).click();
    await expect(page.getByText("Gift card sent.")).toBeVisible();
    codes.push(await codeFromInbox(page, email, `$${amount}.00`));
  }
  const cards = page.getByRole("listitem", { name: /^Gift card ending / });
  await expect(cards).toHaveCount(2);

  // Typed loosely, the way it's read over the phone.
  await page.getByLabel("Find a gift card").fill(codes[1]!.toLowerCase().replace(/-/g, " "));
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole("listitem", { name: `Gift card ending ${codes[1]!.slice(-4)}` })).toContainText("$15.00 left of $15.00");
  await expect(page.getByText(/1 card matches/)).toBeVisible();
  await shot(page, "470-gift-card-find");

  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(cards).toHaveCount(2);
  await page.getByRole("listitem", { name: `Gift card ending ${codes[0]!.slice(-4)}` }).getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("listitem", { name: `Gift card ending ${codes[0]!.slice(-4)}` })).toContainText("Turned off");
  await page.getByRole("navigation", { name: "Gift card filter" }).getByRole("link", { name: "Turned off" }).click();
  await expect(page).toHaveURL(/show=off/);
  await expect(cards).toHaveCount(1);
  await page.getByLabel("Find a gift card").fill(`gc-grace-${id}`);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page).toHaveURL(/q=gc-grace/);
  await expect(page.getByText("No gift card matches.", { exact: false })).toBeVisible();
});
