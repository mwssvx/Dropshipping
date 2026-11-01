import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Milestone 6: the merchant app, run from its web build on a phone-sized screen against this
// server's app API. Native-only parts (push delivery, camera, share sheet) are covered by unit
// tests and the Maestro flows in apps/mobile/.maestro.

const WEB = "http://localhost:3100";
const PASSWORD = "correct horse battery";
const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir) await p.screenshot({ path: `${dir}/${name}.png` });
};

/** A merchant with a store, made on the web (the app has no sign-up yet). */
async function merchant(browser: Browser, id: string) {
  const web = await (await browser.newContext()).newPage();
  const email = `m6-${id}@example.com`;
  await web.goto(`${WEB}/signup`);
  await web.getByLabel("Email").fill(email);
  await web.getByLabel("Password").fill(PASSWORD);
  await web.getByRole("button", { name: "Create account" }).click();
  await web.getByLabel("Store name").fill(`Pocket Shop ${id}`);
  await web.getByRole("button", { name: "Create store" }).click();
  await expect(web.getByRole("heading", { name: /Welcome to Pocket Shop/ })).toBeVisible();
  return { web, email };
}

// Each test opens its own browser windows for the merchant's web admin and for buyers. Close them
// afterwards, or a full run keeps two dozen stores open at once and the later tests slow to a crawl.
test.afterEach(async ({ browser, context }) => {
  await Promise.all(browser.contexts().filter((c) => c !== context).map((c) => c.close()));
});

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Sign in to/ })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
}

async function buy(browser: Browser, productUrl: string, shopper?: Page) {
  const buyer = shopper ?? (await (await browser.newContext()).newPage());
  await buyer.goto(productUrl);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
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
}

test("sign in, then import a product, let AI write it and put it on sale in under a minute", async ({ page, browser }) => {
  const { email } = await merchant(browser, `a${Date.now()}`);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Sign in to/ })).toBeVisible();
  await shot(page, "55-app-sign-in");
  await signIn(page, email);
  await expect(page.getByText("All clear")).toBeVisible();
  await shot(page, "56-app-today-empty");

  const started = Date.now();
  await tab(page, "Products");
  await page.getByRole("button", { name: "Import from a supplier link" }).click();
  await page.getByRole("textbox", { name: "Supplier link" }).fill("https://demo-supplier.test/p/magnetic-phone-stand");
  await page.getByRole("button", { name: "Look it up" }).click();
  await expect(page.getByLabel("Your price")).toBeVisible();
  await shot(page, "57-app-import");
  await page.getByRole("button", { name: "Import as draft" }).click();
  await expect(page.getByText(/Imported as a draft/)).toBeVisible();
  await page.getByRole("button", { name: "Write with AI" }).click();
  await expect(page.getByText("Written with AI")).toBeVisible();
  await page.getByRole("button", { name: "Put on sale" }).click();
  await expect(page.getByText("It's on sale now.")).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);
  await shot(page, "58-app-product");

  // Quick price edit.
  await page.getByRole("textbox", { name: "Price", exact: true }).fill("24.00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.goto("/products");
  await expect(page.getByRole("link", { name: /Magnetic Phone Stand/ })).toContainText("$24.00");
});

test("a problem order: the order fixer proposes a refund, approved from Today", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `b${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /galaxy projector low stock/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();
  await buy(browser, new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href);

  await signIn(page, email);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("link", { name: /1 order needs you/ })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await shot(page, "59-app-today-problem");
  await page.getByRole("link", { name: /1 order needs you/ }).click();
  await page.getByRole("link", { name: "Order #1001" }).click();
  await expect(page.getByText("What went wrong")).toBeVisible();
  // When it should have arrived, as on the web order page, even before it ships.
  await expect(page.getByText(/^Expected to arrive [A-Z][a-z]{2} \d{1,2}( – [A-Z][a-z]{2} \d{1,2})?$/)).toBeVisible();
  await page.getByRole("button", { name: "Ask AI to sort it out" }).click();
  await expect(page.getByText(/proposed a full refund/)).toBeVisible();
  await shot(page, "60-app-order-problem");

  await page.getByText("← Orders").click();
  await tab(page, "Today");
  await page.reload();
  const refund = page.getByRole("article", { name: /Refund \$[\d.]+ on order #1001/ });
  await expect(refund).toBeVisible();
  await expect(page.getByRole("article", { name: "Email the buyer about the problem" }).getByLabel("Message to the buyer")).toHaveValue(/sold out/);
  await shot(page, "61-app-approvals");
  await refund.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Done.", { exact: true })).toBeVisible();
  await page.getByRole("article", { name: "Email the buyer about the problem" }).getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent.", { exact: true })).toBeVisible();

  await tab(page, "Orders");
  // Nothing has shipped, so nothing is late.
  await page.getByRole("tab", { name: "Late" }).click();
  await expect(page.getByText("Nothing late")).toBeVisible();
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByRole("link", { name: "Order #1001" })).toContainText("Refunded");
});

test("money, holds, the assistant, and approvals made offline", async ({ page, browser, context }) => {
  const { web, email } = await merchant(browser, `c${Date.now()}`);
  await web.goto(`${WEB}/admin/money`);
  await web.getByRole("button", { name: "Set up payouts" }).click();
  await expect(web.getByText("Payouts are set up.")).toBeVisible();
  await web.getByLabel("Hold reason").selectOption("identity_document");
  await web.getByRole("button", { name: "Simulate a payout hold" }).click();
  await expect(web.getByRole("heading", { name: /Payouts paused/ })).toBeVisible();

  await signIn(page, email);
  await expect(page.getByRole("link", { name: /Payouts are paused/ })).toBeVisible();
  await page.getByRole("link", { name: /Payouts are paused/ }).click();
  await expect(page.getByRole("heading", { name: "Money", level: 1 })).toBeVisible();
  await expect(page.getByRole("article", { name: "Photo ID" }).getByRole("button", { name: "Take a photo of it" })).toBeVisible();
  await expect(page.getByText("Ready to pay out")).toBeVisible();
  await shot(page, "62-app-money");
  // Today's ad spend, from the phone.
  await page.getByRole("tab", { name: "TikTok" }).click();
  await page.getByLabel("Amount spent").fill("12.50");
  await page.getByRole("button", { name: "Add ad spend" }).click();
  await expect(page.getByText("Ad spend added.")).toBeVisible();
  await expect(page.getByText("−$12.50")).toBeVisible();

  await tab(page, "Assistant");
  await page.getByRole("button", { name: "How am I doing this month?" }).click();
  await expect(page.getByText(/In the last 30 days/)).toBeVisible();
  await page.getByLabel("Message the assistant").fill("Please show prices with VAT included");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "1 change waits for your OK" })).toBeVisible();
  await shot(page, "63-app-assistant");

  // Offline: the approval waits on the phone and goes out once the connection is back.
  await page.getByRole("button", { name: "1 change waits for your OK" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("article", { name: "Show prices with tax included" }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Saved. It's sent when you're back online.")).toBeVisible();
  await expect(page.getByText(/Waiting to send \(1\)/).first()).toBeVisible();
  await shot(page, "64-app-offline");
  await context.setOffline(false);
  await tab(page, "Orders");
  await expect(page.getByText(/Waiting to send/)).toHaveCount(0);

  await web.goto(`${WEB}/admin/ai`);
  await expect(web.getByRole("cell", { name: "Show prices with tax included" })).toBeVisible();
  await expect(web.getByRole("row").filter({ hasText: "Show prices with tax included" })).toContainText("You approved");

  // Settings: notification choices are saved to the account.
  await tab(page, "Today");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Sound for new orders").click();
  await expect(page.getByLabel("Sound for new orders")).not.toBeChecked();
  await shot(page, "65-app-settings");
  await page.reload();
  await expect(page.getByLabel("Sound for new orders")).not.toBeChecked();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: /Sign in to/ })).toBeVisible();
});

test("a buyer's question: answered from the app with a saved reply", async ({ page, browser }) => {
  const id = `i${Date.now()}`;
  const { web, email } = await merchant(browser, id);
  await web.goto(`${WEB}/admin/inbox/replies`);
  await web.getByRole("button", { name: "Add starter replies" }).click();
  await expect(web.getByRole("region", { name: "Returns" })).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(`${WEB}/s/pocket-shop-${id}/contact`);
  await buyer.getByLabel("Your name").fill("Grace Hopper");
  await buyer.getByLabel("Email").fill(`grace-${id}@example.com`);
  await buyer.getByLabel("Message").fill("Do your lamps work with UK plugs?");
  await buyer.getByRole("button", { name: "Send message" }).click();
  await expect(buyer.getByText("Thanks, your message is on its way.")).toBeVisible();

  await signIn(page, email);
  await expect(page.getByText("1 buyer question needs you")).toBeVisible();
  await page.getByRole("button", { name: "Buyer inbox" }).click();
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await page.getByText("Message from Grace Hopper").click();
  await expect(page.getByText("Do your lamps work with UK plugs?", { exact: true })).toBeVisible();
  await shot(page, "393-app-conversation");

  // A saved reply that needs an order number can't go out as it is.
  const box = page.getByRole("textbox", { name: "Your reply" });
  await page.getByRole("button", { name: "How long shipping takes" }).click();
  await expect(box).toHaveValue(/^Hi Grace,\n\nOrders usually leave us/);
  await expect(page.getByText(/Replace \{order_number\} before sending/)).toBeVisible();
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText(/Replace \{order_number\} in the reply first/)).toBeVisible();

  await box.fill("Hi Grace, yes: every lamp comes with a UK plug.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Sent by email.")).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(page.getByText("Hi Grace, yes: every lamp comes with a UK plug.", { exact: true })).toBeVisible();

  // Answered, so it leaves "Needs you".
  await page.getByRole("link", { name: /Inbox/ }).first().click();
  await expect(page.getByText("All caught up")).toBeVisible();
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByLabel("Message from Grace Hopper").filter({ visible: true })).toContainText("Answered");
});

test("an order in two parcels shows what's in each and which one is yours to post", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `p${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(candle);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buy(browser, lamp, buyer);

  await signIn(page, email);
  await tab(page, "Orders");
  await page.getByRole("link", { name: "Order #1001" }).click();
  await expect(page.getByText("Comes in 2 parcels")).toBeVisible();
  await expect(page.getByText("Sent by you · not shipped yet")).toBeVisible();
  // Once in the items and once as its own parcel.
  await expect(page.getByText("Beeswax Candle", { exact: true })).toHaveCount(2);
  await expect(page.getByText("With the supplier · not shipped yet").or(page.getByText(/^Demo Post /))).toBeVisible();
  await shot(page, "318-app-parcels");
});

test("two orders to the same address say the store's items can share a box", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sa${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  await buy(browser, candle);
  await buy(browser, candle);

  await signIn(page, email);
  await tab(page, "Orders");
  // Both have a candle to post, so both are on To post, the oldest first.
  await page.getByRole("tab", { name: "To post" }).click();
  await expect(page.getByRole("link", { name: /^Order #100[12]/ })).toHaveCount(2);
  await expect(page.getByRole("link", { name: /^Order #100[12]/ }).first()).toContainText("#1001");
  await page.getByRole("link", { name: "Order #1002" }).click();
  await expect(page.getByText("Also going to this address")).toBeVisible();
  await expect(page.getByText("Order #1001", { exact: true })).toBeVisible();
  await expect(page.getByText(/has items you post/)).toBeVisible();
  await expect(page.getByText(/can go in one box/)).toBeVisible();
  await shot(page, "324-app-same-address");

  // Both candles go in one box, posted from the phone with one tracking number.
  await expect(page.getByText("Post it yourself")).toBeVisible();
  await page.getByRole("button", { name: "Add tracking" }).click();
  await page.getByLabel("Carrier").fill("USPS");
  await page.getByLabel("Tracking number").fill("9400111899");
  await page.getByRole("switch", { name: "Order #1001 gets this tracking too" }).click();
  await page.getByRole("button", { name: "Save tracking" }).click();
  await expect(page.getByText("Tracking added here and to order #1001. The buyers get an email.")).toBeVisible();
  await expect(page.getByText("Post it yourself")).toHaveCount(0);
  // Shipped now, so it no longer lists the other order; that one has the tracking too.
  await page.goto("/");
  await tab(page, "Orders");
  // Both went in the one box, so nothing is left to post.
  await page.getByRole("tab", { name: "To post" }).click();
  await expect(page.getByText("Nothing to post")).toBeVisible();
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("link", { name: "Order #1001" }).click();
  await expect(page.getByText("USPS 9400111899")).toBeVisible();
});

test("weight and cost of the store's own stock, set from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `wc${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();

  await signIn(page, email);
  await tab(page, "Products");
  // A new product lacks everything but its price: the list says what.
  await page.getByRole("tab", { name: "Needs details (1)" }).click();
  await expect(page.getByText("No photo · No description · No weight · No customs details · No cost")).toBeVisible();
  await shot(page, "335-app-needs-details");
  await page.getByRole("link", { name: /Beeswax Candle/ }).click();
  await page.getByRole("textbox", { name: "What it costs you" }).fill("4.50");
  await expect(page.getByText("You keep $7.50 of each before fees.")).toBeVisible();
  await page.getByRole("textbox", { name: "Weight packed (kg)" }).fill("0.3");
  await shot(page, "334-app-weight-cost");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "What it costs you" })).toHaveValue("4.50");
  await expect(page.getByRole("textbox", { name: "Weight packed (kg)" })).toHaveValue("0.3");
  // Weight and cost are off its list now.
  await page.goto("/");
  await tab(page, "Products");
  await page.getByRole("tab", { name: "Needs details (1)" }).click();
  await expect(page.getByText("No photo · No description · No customs details", { exact: true })).toBeVisible();

  // Customs details from the phone too: a wrong code says how it should look.
  await page.getByRole("link", { name: /Beeswax Candle/ }).click();
  await page.getByRole("textbox", { name: "HS code" }).fill("34");
  await page.getByRole("textbox", { name: "Made in (country code)" }).fill("us");
  await expect(page.getByRole("textbox", { name: "Made in (country code)" })).toHaveValue("US");
  await page.getByRole("button", { name: "Save customs details" }).click();
  await expect(page.getByText("An HS code is 6 to 10 digits, like 6912.00 or 691200.")).toBeVisible();
  await page.getByRole("textbox", { name: "HS code" }).fill("3406.00");
  await shot(page, "336-app-customs");
  await page.getByRole("button", { name: "Save customs details" }).click();
  await expect(page.getByText("Customs details saved.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "HS code" })).toHaveValue("340600");
  await page.goto("/");
  await tab(page, "Products");
  await page.getByRole("tab", { name: "Needs details (1)" }).click();
  await expect(page.getByText("No photo · No description", { exact: true })).toBeVisible();

  // Two left is at the store's running-low number (3), so it shows under Low; none left, under Sold out.
  for (const [left, list] of [["2", "Low (1)"], ["0", "Sold out (1)"]] as const) {
    await page.getByRole("tab", { name: "All" }).click();
    await page.getByRole("link", { name: /Beeswax Candle/ }).click();
    await page.getByRole("textbox", { name: "Stock", exact: true }).fill(left);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    await page.goto("/");
    await tab(page, "Products");
    await page.getByRole("tab", { name: list }).click();
    await expect(page.getByRole("link", { name: /Beeswax Candle/ })).toBeVisible();
  }
  await shot(page, "337-app-sold-out");

  // Search looks in the list that's open, by name or SKU.
  await page.getByRole("textbox", { name: "Search products" }).fill("candle");
  await expect(page.getByRole("link", { name: /Beeswax Candle/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Search products" }).fill("mug");
  await expect(page.getByText('No products match "mug".')).toBeVisible();
  await expect(page.getByRole("link", { name: /Beeswax Candle/ })).toHaveCount(0);
});

test("reviews: one waiting is published and another gets a reply, from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `rv${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();
  const handle = (await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.split("/products/")[1]!;
  await web.goto(`${WEB}/admin/products/move`);
  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,,Ada L.,ada@example.com,,"Warm light, perfect for the bedroom.",,2025-03-04 10:00:00 UTC,`,
    `${handle},pending,3,,Grace H.,grace@example.com,,Smaller than I thought.,,2025-04-01 12:00:00 UTC,`,
  ].join("\n");
  await web.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await web.getByRole("button", { name: "Add reviews" }).click();
  await expect(web.getByRole("status")).toContainText("2 reviews added");

  await signIn(page, email);
  await page.getByRole("button", { name: "Reviews (1 to check)" }).click();
  // Grace's is waiting for an OK.
  await expect(page.getByRole("tab", { name: "To check (1)" })).toBeVisible();
  await expect(page.getByText("Smaller than I thought.")).toBeVisible();
  await expect(page.getByText("★★★☆☆  3 out of 5")).toBeVisible();
  await shot(page, "340-app-reviews");
  await page.getByRole("button", { name: "Publish Grace H.'s review" }).click();
  await expect(page.getByText("Nothing to check")).toBeVisible();

  // Both are live now with no reply; answer Ada's.
  await page.getByRole("tab", { name: "No reply (2)" }).click();
  await page.getByRole("textbox", { name: "Reply to Ada L." }).fill("Thanks Ada, glad it suits the room!");
  await page.getByRole("button", { name: "Post reply to Ada L." }).click();
  await expect(page.getByRole("tab", { name: "No reply (1)" })).toBeVisible();
  await expect(page.getByText("Warm light, perfect for the bedroom.")).toHaveCount(0);
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByRole("textbox", { name: "Reply to Ada L." })).toHaveValue("Thanks Ada, glad it suits the room!");
});

test("a customer's orders, note and tags, from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `cu${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  await buy(browser, candle);
  await buy(browser, candle);

  await signIn(page, email);
  await page.getByRole("button", { name: "Customers" }).click();
  await expect(page.getByRole("link", { name: /Ada Buyer/ })).toContainText("2 orders");
  // A search that matches nobody says so.
  await page.getByRole("textbox", { name: "Search customers" }).fill("nobody");
  await expect(page.getByText("No one matches")).toBeVisible();
  await page.getByRole("textbox", { name: "Search customers" }).fill("ada@");
  await page.getByRole("link", { name: /Ada Buyer/ }).click();
  await expect(page.getByText("ada@example.com", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Order #1001/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Order #1002/ })).toBeVisible();

  await page.getByRole("textbox", { name: "Note" }).fill("Prefers gift wrap");
  await page.getByRole("textbox", { name: "Tags" }).fill("vip, local");
  await shot(page, "341-app-customer");
  await page.getByRole("button", { name: "Save note and tags" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Tags" })).toHaveValue("vip, local");
  await expect(page.getByRole("textbox", { name: "Note" })).toHaveValue("Prefers gift wrap");
  // An order opens from there.
  await page.getByRole("link", { name: /Order #1001/ }).click();
  await expect(page.getByText("Beeswax Candle").first()).toBeVisible();
  // And the order leads back to them, with their tags.
  const them = page.getByRole("link", { name: "Customer Ada Buyer" });
  await expect(them).toContainText("2 orders from them");
  await expect(them).toContainText("vip, local");

  // The Orders tab finds an order by its number, or the buyer's name or email.
  await page.goto("/");
  await tab(page, "Orders");
  await page.getByRole("textbox", { name: "Search orders" }).fill("#1002");
  await expect(page.getByRole("link", { name: "Order #1002" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Order #1001" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Open" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search orders" }).fill("ada@");
  await expect(page.getByRole("link", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Order #1002" })).toBeVisible();
  await shot(page, "348-app-order-search");
  await page.getByRole("textbox", { name: "Search orders" }).fill("nobody");
  await expect(page.getByText("No order matches")).toBeVisible();
  await page.getByRole("textbox", { name: "Search orders" }).fill("");
  await expect(page.getByRole("tab", { name: "Open" })).toBeVisible();
});

test("a discount code made, checked and turned off from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `dc${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("button", { name: "Discount codes" }).click();
  await expect(page.getByText("No codes yet")).toBeVisible();

  await page.getByRole("textbox", { name: "Code" }).fill("welcome 10");
  await expect(page.getByRole("textbox", { name: "Code" })).toHaveValue("WELCOME10");
  await page.getByRole("textbox", { name: "Percent off" }).fill("10");
  await page.getByRole("switch", { name: "First order only" }).click();
  await shot(page, "343-app-new-code");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("WELCOME10 is ready: 10% off.")).toBeVisible();
  await expect(page.getByText("10% off · first order only")).toBeVisible();
  await expect(page.getByText("Not used yet")).toBeVisible();

  // The same code twice is refused with the reason.
  await page.getByRole("textbox", { name: "Code" }).fill("WELCOME10");
  await page.getByRole("tab", { name: "Free shipping" }).click();
  await expect(page.getByRole("textbox", { name: "Percent off" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("You already have a code called WELCOME10.")).toBeVisible();

  // An amount off, in money.
  await page.getByRole("textbox", { name: "Code" }).fill("FIVE");
  await page.getByRole("tab", { name: "Amount off" }).click();
  await page.getByRole("textbox", { name: "Amount off" }).fill("5");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText(/FIVE is ready: \$5\.00 off/)).toBeVisible();

  await page.getByRole("switch", { name: "WELCOME10 is on" }).click();
  await expect(page.getByText("WELCOME10 is off. Buyers who try it are told it doesn't work.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "WELCOME10 is on" })).not.toBeChecked();

  // The website sees the same codes, and the activity log says it was done from the app.
  await web.goto(`${WEB}/admin/marketing`);
  await expect(web.getByText("WELCOME10").first()).toBeVisible();
  await expect(web.getByText("FIVE").first()).toBeVisible();
  await web.goto(`${WEB}/admin/activity`);
  await expect(web.getByText("Turned off the discount code WELCOME10 in the app")).toBeVisible();
});

test("a crossed-out price set from the app shows as a sale on the store", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `cp${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /Beeswax Candle/ }).click();
  const was = page.getByRole("textbox", { name: "Crossed-out price" });
  await was.fill("10");
  await expect(page.getByText("Make it higher than the price, or leave it empty.")).toBeVisible();
  await was.fill("16.00");
  await expect(page.getByText("Buyers see 25% off.")).toBeVisible();
  await shot(page, "344-app-crossed-out-price");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(was).toHaveValue("16.00");

  // The store shows the old price struck through next to the new one.
  await web.goto(candle);
  await expect(web.locator("s", { hasText: "$16.00" }).first()).toBeVisible();

  // Emptied, the sale ends.
  await was.fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await web.reload();
  await expect(web.locator("s", { hasText: "$16.00" })).toHaveCount(0);
});

test("returns answered from the app: one declined with a reason, one refunded", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `rt${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  for (const [reason, note] of [["I changed my mind", null], ["It arrived damaged", "The wax is cracked."]] as const) {
    const buyer = await (await browser.newContext()).newPage();
    await buy(browser, candle, buyer);
    await buyer.getByText("Return something").click();
    await buyer.getByLabel("Why?").selectOption({ label: reason });
    if (note) await buyer.getByLabel(/Anything the store should know/).fill(note);
    await buyer.getByRole("button", { name: "Ask for a return" }).click();
    await expect(buyer.locator("#returns")).toContainText("you asked for a return");
  }

  await signIn(page, email);
  // Today says how many wait.
  await page.getByRole("button", { name: "Returns (2 open)" }).click();
  await expect(page.getByRole("tab", { name: "Open (2)" })).toBeVisible();
  await expect(page.getByText('It arrived damaged: "The wax is cracked."')).toBeVisible();
  await shot(page, "345-app-returns");

  // Declining needs a reason the buyer can act on.
  await page.getByRole("button", { name: "Decline the return on order #1001" }).click();
  await expect(page.getByText("Tell the buyer why, so they know what to do next.")).toBeVisible();
  await page.getByRole("textbox", { name: "Message for order #1001" }).fill("Candles can't come back once lit.");
  await page.getByRole("button", { name: "Decline the return on order #1001" }).click();
  await expect(page.getByText("Declined. The buyer gets an email with your reason.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Open (1)" })).toBeVisible();

  // The damaged one: refunded what they paid.
  await expect(page.getByRole("textbox", { name: "Amount for order #1002" })).not.toHaveValue("");
  await page.getByRole("button", { name: "Refund the return on order #1002" }).click();
  await expect(page.getByText(/^Refunded \$\d+\.\d\d\. The buyer gets an email\.$/)).toBeVisible();
  await expect(page.getByText("No returns to answer")).toBeVisible();

  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByText("Declined", { exact: true })).toBeVisible();
  await expect(page.getByText("Refunded", { exact: true })).toBeVisible();
  await expect(page.getByText("You said: Candles can't come back once lit.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Returns", exact: true })).toBeVisible();

  // The website shows the same answers, and the activity log says they came from the app.
  await web.goto(`${WEB}/admin/activity`);
  await expect(web.getByText("Declined the return on order #1001 in the app")).toBeVisible();
});

test("store credit given to a customer from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sc${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  await buy(browser, new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href);

  await signIn(page, email);
  await page.getByRole("button", { name: "Customers" }).click();
  await page.getByRole("link", { name: /Ada Buyer/ }).click();
  await expect(page.getByRole("button", { name: "Give store credit" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Credit to give" }).fill("abc");
  await page.getByRole("button", { name: "Give store credit" }).click();
  await expect(page.getByText("Enter the amount, like 10.")).toBeVisible();
  await page.getByRole("textbox", { name: "Credit to give" }).fill("5");
  await page.getByRole("textbox", { name: "Why", exact: true }).fill("Parcel was a week late");
  await shot(page, "346-app-store-credit");
  await page.getByRole("button", { name: "Give store credit" }).click();
  await expect(page.getByText("$5.00 in store credit sent to ada@example.com.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Credit to give" })).toHaveValue("");

  // It's a gift card in their name on the website, and the log says who gave it.
  await web.goto(`${WEB}/admin/gift-cards`);
  await expect(web.getByRole("listitem", { name: /Gift card ending/ })).toContainText("$5.00 left of $5.00");
  await expect(web.getByRole("listitem", { name: /Gift card ending/ })).toContainText("ada@example.com · Given by you");
  await web.goto(`${WEB}/admin/activity`);
  await expect(web.getByText("Gave $5.00 store credit to ada@example.com in the app")).toBeVisible();
});

test("a sale on everything started, kept on longer and ended from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sl${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await expect(page.getByText("No sales yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Sale name" }).fill("Weekend sale");
  await page.getByRole("textbox", { name: "Percent off everything" }).fill("95");
  await page.getByRole("tab", { name: "1 day" }).click();
  await page.getByRole("switch", { name: "Countdown on the store" }).click();
  await page.getByRole("button", { name: "Start the sale" }).click();
  await expect(page.getByText("A sale takes up to 90% off.")).toBeVisible();
  await page.getByRole("textbox", { name: "Percent off everything" }).fill("20");
  await shot(page, "349-app-sales");
  await page.getByRole("button", { name: "Start the sale" }).click();
  await expect(page.getByText("Weekend sale is on: 20% off everything, for 1 day.")).toBeVisible();
  await expect(page.getByText("Weekend sale · 20% off")).toBeVisible();
  await expect(page.getByText("On now", { exact: true })).toBeVisible();

  // The store charges the sale price with the old one crossed out.
  await web.goto(candle);
  await expect(web.locator("s", { hasText: "$12.00" }).first()).toBeVisible();
  await expect(web.getByText("$9.60").first()).toBeVisible();

  await page.getByRole("button", { name: "Keep Weekend sale on one more day" }).click();
  await expect(page.getByText("Weekend sale runs 1 more day.")).toBeVisible();
  await page.getByRole("button", { name: "End Weekend sale now" }).click();
  await expect(page.getByText("Weekend sale has ended. Prices are back to normal.")).toBeVisible();
  await expect(page.getByText("Ended", { exact: true })).toBeVisible();
  await web.reload();
  await expect(web.locator("s", { hasText: "$12.00" })).toHaveCount(0);

  await web.goto(`${WEB}/admin/activity`);
  await expect(web.getByText("Started the sale Weekend sale (20% off everything) in the app")).toBeVisible();
});

test("a pickup order told ready and handed over from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pu${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Clay Planter");
  await web.getByLabel("Price", { exact: true }).fill("24.00");
  await web.getByLabel("Stock", { exact: true }).fill("4");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const planter = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  await web.goto(`${WEB}/admin/shipping`);
  await web.getByLabel("Let buyers pick up their order").check();
  await web.getByLabel("Pickup address").fill("Corner Studio\n12 Congress Ave, Austin");
  await web.getByRole("button", { name: "Save pickup" }).click();
  await expect(web.getByText("Saved. Buyers can pick up orders of your own stock.")).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(planter);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("radio", { name: /Pick it up yourself/ }).check();
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const orderPage = buyer.url();

  await signIn(page, email);
  await tab(page, "Orders");
  // The Hand over list has what's waiting to be collected or dropped off.
  await page.getByRole("tab", { name: "Hand over" }).click();
  await expect(page.getByRole("link", { name: "Order #1001" })).toContainText("Pickup · no day picked");
  await page.getByRole("link", { name: "Order #1001" }).click();
  await expect(page.getByText("Picking up", { exact: true })).toBeVisible();
  // Nothing to post or track: it's collected.
  await expect(page.getByText("Post it yourself")).toHaveCount(0);
  await shot(page, "350-app-pickup");
  await page.getByRole("button", { name: "Ready for pickup" }).click();
  await expect(page.getByText("The buyer was emailed that it's ready to pick up.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ready for pickup" })).toHaveCount(0);
  await buyer.goto(orderPage);
  await expect(buyer.getByText("Your order is ready to pick up from:")).toBeVisible();

  await page.getByRole("button", { name: "Picked up" }).click();
  await expect(page.getByText("Marked picked up. The buyer gets an email.")).toBeVisible();
  await expect(page.getByText("Picking up", { exact: true })).toHaveCount(0);
  await buyer.goto(orderPage);
  await expect(buyer.getByText("You picked up this order.")).toBeVisible();
  await web.goto(`${WEB}/admin/activity`);
  await expect(web.getByText("Marked order #1001 picked up in the app")).toBeVisible();
  await page.goto("/orders?show=handover");
  await expect(page.getByText("Nothing to hand over")).toBeVisible();
});

test("a gift card sent, looked up by its code and turned off from the app", async ({ page, browser }) => {
  const id = `gc${Date.now()}`;
  const { web, email } = await merchant(browser, id);
  const friend = `friend-${id}@example.com`;
  await signIn(page, email);
  await page.getByRole("button", { name: "Gift cards" }).click();
  await expect(page.getByText("No gift cards yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Their email" }).fill(friend);
  await page.getByRole("textbox", { name: "Gift card amount" }).fill("25");
  await page.getByRole("button", { name: "Send gift card" }).click();
  await expect(page.getByText(`A $25.00 gift card is on its way to ${friend}.`)).toBeVisible();
  await expect(page.getByText("$25.00 left of $25.00")).toBeVisible();

  // The buyer reads out the code from their email; it finds the card.
  await web.goto(`${WEB}/dev/mail`);
  const mail = await web.getByRole("article").filter({ hasText: friend }).first().textContent();
  const code = mail!.match(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}/)![0];
  await page.getByRole("textbox", { name: "Find a gift card" }).fill("ZZZZ");
  await expect(page.getByText("No gift card matches")).toBeVisible();
  await page.getByRole("textbox", { name: "Find a gift card" }).fill(code.toLowerCase());
  await expect(page.getByText(`···· ${code.slice(-4)}`)).toBeVisible();
  await shot(page, "352-app-gift-cards");

  await page.getByRole("button", { name: `Turn off the card ending ${code.slice(-4)}` }).click();
  await expect(page.getByText(`The card ending ${code.slice(-4)} is off. It can't be spent until you turn it back on.`)).toBeVisible();
  await expect(page.getByText("Turned off", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Turn on the card ending ${code.slice(-4)}` }).click();
  await expect(page.getByText(`The card ending ${code.slice(-4)} works again.`)).toBeVisible();

  await web.goto(`${WEB}/admin/activity`);
  await expect(web.getByText(`Gave a $25.00 gift card to ${friend} in the app`)).toBeVisible();
});

test("a holiday break started and ended from the app's settings", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `hb${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Back on" }).fill("2020-01-01");
  await page.getByRole("button", { name: "Take a break" }).click();
  await expect(page.getByText("Pick a date after today, or leave it empty to open the store yourself.")).toBeVisible();
  const back = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await page.getByRole("textbox", { name: "Back on" }).fill(back);
  await page.getByRole("textbox", { name: "Message to buyers" }).fill("Back from the trade fair soon.");
  await shot(page, "353-app-store-break");
  await page.getByRole("button", { name: "Take a break" }).click();
  await expect(page.getByText(`Your store is on a break until ${back}. Buyers can look around but can't order.`)).toBeVisible();
  await expect(page.getByText("On a break", { exact: true })).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(candle);
  await expect(buyer.getByText(/We're taking a break and back on .*orders are paused until then\./)).toBeVisible();
  await expect(buyer.getByText("Back from the trade fair soon.")).toBeVisible();

  await page.getByRole("button", { name: "Open the store now" }).click();
  await expect(page.getByText("Your store is open. Buyers can order again.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByText(/orders are paused/)).toHaveCount(0);
  await web.goto(`${WEB}/admin/activity`);
  await expect(web.getByText("Put the store on a break in the app")).toBeVisible();
});

test("a buyer blocked from an order in the app can't check out again", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `bb${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  const buyer = await (await browser.newContext()).newPage();
  await buy(browser, candle, buyer);

  await signIn(page, email);
  await tab(page, "Orders");
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("link", { name: "Order #1001" }).click();
  await page.getByRole("button", { name: "Block this buyer…" }).click();
  await page.getByRole("textbox", { name: "Why (only your team sees this)" }).fill("Chargeback");
  await shot(page, "354-app-block-buyer");
  await page.getByRole("button", { name: "Block Ada Buyer" }).click();
  await expect(page.getByText(/^Ada Buyer can't check out at your store any more/)).toBeVisible();
  await expect(page.getByText("Blocked from checking out")).toBeVisible();

  // The same buyer comes back: turned away before paying.
  await buyer.goto(candle);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByRole("main").getByRole("alert")).toHaveText(/We can't take this order\./);
  await web.goto(`${WEB}/admin/blocked`);
  await expect(web.getByText("ada@example.com").first()).toBeVisible();
});

test("checkouts left unpaid, and the reminder sent, shown in the app", async ({ page, browser }) => {
  const id = `lc${Date.now()}`;
  const { web, email } = await merchant(browser, id);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const candle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await tab(page, "Orders");
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("link", { name: /Left at checkout/ }).click();
  await expect(page.getByText("Nobody left at checkout")).toBeVisible();

  // A buyer leaves at payment, and the reminder goes out.
  const left = `left-${id}@example.com`;
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(candle);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill(left);
  await buyer.getByLabel("Full name").fill("Grace Hopper");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByRole("button", { name: /^Pay/ })).toBeVisible();
  await buyer.context().close();
  await web.goto(`${WEB}/admin/marketing`);
  await web.getByRole("region", { name: "Checkout reminders" }).getByRole("button", { name: "Send reminders now" }).click();
  await expect(web.getByRole("region", { name: "Checkout reminders" }).getByText("Sent, last 30 days").locator("..")).toContainText("1");

  await page.reload();
  // Tapping a buyer starts an email to them, so the row is a button.
  const row = page.getByRole("button", { name: "Checkout by Grace Hopper" });
  await expect(row).toContainText("· 1 item ·");
  await expect(row).toContainText("Reminded");
  await expect(row).toContainText("Not yet");
  await expect(page.getByText("Left unpaid")).toBeVisible();
  await shot(page, "355-app-left-at-checkout");
});

test("a dispute answered from the app with the evidence and a note", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `dp${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Linen Apron");
  await web.getByLabel("Price", { exact: true }).fill("28.00");
  await web.getByLabel("Stock", { exact: true }).fill("5");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  await buy(browser, new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href);

  // The buyer's bank opens a dispute (test mode stands in for the bank).
  await web.goto(`${WEB}/admin/orders`);
  await web.getByRole("link", { name: "#1001" }).click();
  await expect(web).toHaveURL(/\/admin\/orders\/[^/]+$/);
  const simulate = web.getByText("Test mode: simulate a dispute");
  await expect(async () => {
    await web.reload();
    await expect(simulate).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await simulate.click();
  await web.getByRole("button", { name: "Simulate a dispute" }).click();
  await expect(web.getByText("Needs your answer").first()).toBeVisible();

  await signIn(page, email);
  await tab(page, "Money");
  await page.getByRole("link", { name: /Disputes \(1 to answer\)/ }).click();
  await expect(page.getByRole("heading", { name: "Disputes", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Dispute on order #1001" }).click();
  const dispute = page.getByRole("region", { name: /^Disputed: \$/ });
  await expect(dispute.getByText("Needs your answer")).toBeVisible();
  await expect(dispute.getByText("The money is held until the bank decides.", { exact: false })).toBeVisible();
  await expect(dispute.getByRole("list", { name: "Evidence" }).getByText("✗ Tracking number")).toBeVisible();
  await dispute.getByRole("textbox", { name: "Anything to add (optional)" }).fill("The buyer emailed to say thanks.");
  await shot(page, "357-app-dispute");
  await dispute.getByRole("button", { name: "Send evidence" }).click();
  await expect(page.getByText("Evidence sent. The bank will decide, and the result shows here.")).toBeVisible();
  await expect(dispute.getByText("Bank reviewing")).toBeVisible();
  await expect(dispute.getByText("Your note: The buyer emailed to say thanks.")).toBeVisible();

  // The website shows the same, and the activity log says it was the app.
  await web.goto(`${WEB}/admin/disputes`);
  await expect(web.getByText("Bank reviewing").first()).toBeVisible();
  await web.goto(`${WEB}/admin/activity`);
  await expect(web.getByText("ent the evidence for the dispute on order #1001 in the app")).toBeVisible();
});

test("a shopper's question about a product answered from the app shows on its page", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pq${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Travel Kettle");
  await web.getByLabel("Price", { exact: true }).fill("34.00");
  await web.getByLabel("Stock", { exact: true }).fill("4");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const kettle = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(kettle);
  const ask = shopper.getByRole("region", { name: "Questions" }).getByRole("form", { name: "Ask a question" });
  await ask.getByLabel("Your question").fill("Does it work on 230 volts in Europe?");
  await ask.getByLabel("Your name").fill("Grace");
  await ask.getByLabel("Email").fill("grace@example.com");
  await ask.getByRole("button", { name: "Send question" }).click();
  await expect(shopper.getByText("Thanks! We'll email you the answer.")).toBeVisible();

  await signIn(page, email);
  await page.getByRole("button", { name: "Questions (1 to answer)" }).click();
  await expect(page.getByRole("heading", { name: "Questions", level: 1 })).toBeVisible();
  const card = page.getByRole("article", { name: "Grace's question about Travel Kettle" });
  await expect(card.getByText("Does it work on 230 volts in Europe?")).toBeVisible();
  await card.getByRole("textbox", { name: "Answer to Grace" }).fill("Yes, it works from 100 to 240 volts.");
  await shot(page, "358-app-question");
  await card.getByRole("button", { name: "Send answer" }).click();
  await expect(page.getByText("Answer sent. Grace gets it by email. It shows on the product page.")).toBeVisible();
  await expect(page.getByText("No questions to answer")).toBeVisible();

  // Everyone sees the answer on the product page; the shopper has it by email.
  await shopper.goto(kettle);
  await expect(shopper.getByRole("region", { name: "Questions" }).getByText("Yes, it works from 100 to 240 volts.")).toBeVisible();
  await shopper.goto(`${WEB}/dev/mail`);
  await expect(shopper.getByText("Your question about Travel Kettle").first()).toBeVisible();

  // Taken off the page from the All list.
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("article", { name: "Grace's question about Travel Kettle" }).getByRole("button", { name: "Take off the page" }).click();
  await expect(page.getByText("Taken off the product page. They still have the answer by email.")).toBeVisible();
  await shopper.goto(kettle);
  await expect(shopper.getByRole("region", { name: "Questions" }).getByText("Yes, it works from 100 to 240 volts.")).toHaveCount(0);
});

test("a payment link made in the app is emailed, shared and paid", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pl${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Linen Throw");
  await web.getByLabel("Price", { exact: true }).fill("45.00");
  await web.getByLabel("Stock", { exact: true }).fill("8");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();

  await signIn(page, email);
  await tab(page, "Orders");
  await page.getByRole("link", { name: /Create a payment link/ }).click();
  await expect(page.getByRole("heading", { name: "Payment link", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Add a product" }).fill("linen");
  await page.getByRole("button", { name: "Add Linen Throw" }).click();
  await page.getByRole("button", { name: "One more Linen Throw" }).click();
  await expect(page.getByText("Items: $90.00")).toBeVisible();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("grace@example.com");
  await page.getByRole("textbox", { name: "Full name" }).fill("Grace Hopper");
  await page.getByRole("textbox", { name: "Address", exact: true }).fill("1 Main St");
  await page.getByRole("textbox", { name: "City" }).fill("Austin");
  await page.getByRole("textbox", { name: "State or region" }).fill("TX");
  await page.getByRole("textbox", { name: "Postal code" }).fill("78701");
  await page.getByRole("textbox", { name: "Note to the customer" }).fill("Two throws, as we talked about on Instagram.");
  await shot(page, "359-app-payment-link");
  await page.getByRole("button", { name: "Email the payment link" }).click();

  await expect(page.getByText("Payment link emailed to grace@example.com.")).toBeVisible();
  const link = page.getByRole("region", { name: "Payment link" });
  await expect(link.getByText("Waiting for Grace to pay")).toBeVisible();
  await expect(link.getByText("Two throws, as we talked about on Instagram.")).toBeVisible();
  const url = (await link.getByText(/\/pay\//).textContent())!.trim();
  await link.getByRole("button", { name: "Email it again" }).click();
  await expect(page.getByText("Emailed to grace@example.com again.")).toBeVisible();

  // Grace pays from the email; the order becomes an ordinary paid order.
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(`${WEB}/dev/mail`);
  await expect(buyer.getByRole("article").filter({ hasText: "grace@example.com" }).filter({ hasText: "is ready to pay" }).first()).toContainText(url);
  await buyer.goto(url);
  await expect(buyer.getByText("Two throws, as we talked about on Instagram.")).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Order #/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payment link" })).toHaveCount(0);
});

test("analytics in the app: sales, visitors and best sellers over the last days", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `an${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Pine Candle");
  await web.getByLabel("Price", { exact: true }).fill("18.00");
  await web.getByLabel("Stock", { exact: true }).fill("9");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  await buy(browser, new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href);

  await signIn(page, email);
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();
  await expect(page.getByText("Orders · New", { exact: true })).toBeVisible();
  await expect(page.getByText("Changes are vs the 7 days before.", { exact: false })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Sales by day, highest \$/ })).toBeVisible();
  await expect(page.getByText("Pine Candle", { exact: true })).toBeVisible();
  await expect(page.getByText(/^1 sold · \d+ views?$/)).toBeVisible();
  await expect(page.getByText("Started checkout", { exact: true })).toBeVisible();
  await shot(page, "360-app-analytics");

  await page.getByRole("tab", { name: "30 days" }).click();
  await expect(page.getByText("Changes are vs the 30 days before.", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "Last year" }).click();
  await expect(page.getByText("Changes are vs the same days last year.", { exact: false })).toBeVisible();
});

test("the team's activity, with what was done in the app, from Settings", async ({ page, browser }) => {
  const { email } = await merchant(browser, `ac${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("button", { name: "Discount codes" }).click();
  await page.getByRole("textbox", { name: "Code" }).fill("SPRING5");
  await page.getByRole("textbox", { name: "Percent off" }).fill("5");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("SPRING5 is ready: 5% off.")).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("link", { name: /^Activity/ }).click();
  await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
  await expect(page.getByText(`${email} created the discount code SPRING5 in the app`)).toBeVisible();
  await expect(page.getByRole("heading", { name: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()) })).toBeVisible();
  await shot(page, "361-app-activity");
});

test("a buyer's subscription seen, sent early in test mode and cancelled from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sb${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Coffee Beans");
  await web.getByLabel("Price", { exact: true }).fill("16.00");
  await web.getByLabel("Stock", { exact: true }).fill("50");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const beans = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  await web.goto(`${WEB}/admin/marketing`);
  const setting = web.getByRole("region", { name: "Subscribe and save" });
  await setting.getByLabel("Let buyers subscribe to their order").check();
  await setting.getByLabel("Subscriber saves (%)").fill("10");
  await setting.getByRole("button", { name: "Save subscribe and save" }).click();
  await expect(setting.getByText("Saved. Buyers see the offer on their order page after paying.")).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buy(browser, beans, buyer);
  const offer = buyer.getByRole("region", { name: "Get this again automatically and save 10%" });
  await expect(async () => {
    await buyer.reload();
    await expect(offer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await offer.getByLabel("How often").selectOption({ label: "Every 2 weeks" });
  await offer.getByRole("button", { name: "Subscribe and save 10%" }).click();
  await expect(buyer.getByText(/You're subscribed\./)).toBeVisible();

  await signIn(page, email);
  await tab(page, "Orders");
  await page.getByRole("link", { name: /^Subscriptions/ }).click();
  await expect(page.getByRole("heading", { name: "Subscriptions", level: 1 })).toBeVisible();
  const sub = page.getByRole("article", { name: "Ada Buyer's subscription" });
  await expect(sub.getByText("1 × Coffee Beans")).toBeVisible();
  await expect(sub.getByText(/^Every 2 weeks, 10% off · next on /)).toBeVisible();
  await expect(sub.getByText("Active", { exact: true })).toBeVisible();
  await shot(page, "362-app-subscriptions");

  await sub.getByRole("button", { name: "Test mode: send the next delivery now" }).click();
  await expect(page.getByText("Placed order #1002.")).toBeVisible();
  await expect(sub.getByText(/^1 delivery so far · /)).toBeVisible();

  await sub.getByRole("button", { name: "Cancel Ada Buyer's subscription…" }).click();
  await sub.getByRole("button", { name: "Cancel Ada Buyer's subscription", exact: true }).click();
  await expect(page.getByText("Cancelled. We've emailed ada@example.com.")).toBeVisible();
  await expect(page.getByText("No subscriptions yet")).toBeVisible();
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByRole("article", { name: "Ada Buyer's subscription" }).getByText("Cancelled", { exact: true })).toBeVisible();
});

test("an email blocked and unblocked from the app's Blocked buyers", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `bl${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Clay Mug");
  await web.getByLabel("Price", { exact: true }).fill("14.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const mug = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await page.getByRole("button", { name: "Customers" }).click();
  await page.getByRole("link", { name: /^Blocked buyers/ }).click();
  await expect(page.getByText("Nobody is blocked")).toBeVisible();
  await page.getByRole("textbox", { name: "Email to block" }).fill("Ada@Example.com");
  await page.getByRole("textbox", { name: "Why (only your team sees this)" }).fill("Two chargebacks");
  await page.getByRole("button", { name: "Block this email" }).click();
  await expect(page.getByText("ada@example.com can't check out at your store any more.")).toBeVisible();
  const row = page.getByRole("article", { name: "Blocked ada@example.com" });
  await expect(row.getByText(/Two chargebacks/)).toBeVisible();
  await shot(page, "363-app-blocked");

  // Turned away at checkout.
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(mug);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByRole("main").getByRole("alert")).toHaveText(/We can't take this order\./);

  // Unblocked, and the same buyer can pay.
  await row.getByRole("button", { name: "Unblock ada@example.com…" }).click();
  await row.getByRole("button", { name: "Unblock ada@example.com", exact: true }).click();
  await expect(page.getByText("ada@example.com can check out again.")).toBeVisible();
  await expect(page.getByText("Nobody is blocked")).toBeVisible();
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
});

test("a teammate invited from the app joins, is made an admin and removed", async ({ page, browser }) => {
  const id = `tm${Date.now()}`;
  const { web, email } = await merchant(browser, id);
  await signIn(page, email);
  await page.goto("/settings");
  await page.getByRole("link", { name: /^People/ }).click();
  await expect(page.getByRole("heading", { name: "Team", level: 1 })).toBeVisible();
  await expect(page.getByText(/Staff accounts come with the Scale plan/)).toBeVisible();

  await web.goto(`${WEB}/admin/plan`);
  await web.getByRole("button", { name: "Upgrade to Scale" }).click();
  await expect(web.getByRole("heading", { name: "You're on Scale" })).toBeVisible();

  await page.reload();
  await expect(page.getByText(/^0 of 15 staff accounts used/)).toBeVisible();
  const sam = `sam-${id}@example.com`;
  await page.getByRole("textbox", { name: "Their email" }).fill(sam);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invite sent to ${sam}. The link works for a week.`)).toBeVisible();
  await expect(page.getByRole("article", { name: `Invite for ${sam}` }).getByText(/^Invited as staff/)).toBeVisible();
  await shot(page, "364-app-team");

  // Sam joins from the email.
  const person = await (await browser.newContext()).newPage();
  await person.goto(`${WEB}/dev/mail`);
  const mail = person.getByRole("article").filter({ hasText: sam }).first();
  await expect(mail).toContainText("Join Pocket Shop");
  await person.goto(`${WEB}${new URL((await mail.textContent())!.match(/https?:\/\/\S+\/invite\/[\w-]+/)![0]).pathname}`);
  await person.getByRole("link", { name: "Create an account" }).click();
  await person.getByLabel("Password").fill(PASSWORD);
  await person.getByRole("button", { name: "Create account" }).click();
  await person.getByRole("button", { name: /^Join Pocket Shop/ }).click();
  await expect(person.getByRole("heading", { name: /^Welcome to Pocket Shop/ })).toBeVisible();

  await page.reload();
  const member = page.getByRole("article", { name: sam });
  await expect(member.getByText("Staff", { exact: true })).toBeVisible();
  await member.getByRole("button", { name: `Change ${sam}…` }).click();
  await member.getByRole("button", { name: "Make admin" }).click();
  await expect(page.getByText(`${sam} is an admin now.`)).toBeVisible();
  await expect(page.getByRole("article", { name: sam }).getByText("Admin", { exact: true })).toBeVisible();
  await page.getByRole("article", { name: sam }).getByRole("button", { name: `Change ${sam}…` }).click();
  await page.getByRole("article", { name: sam }).getByRole("button", { name: `Remove ${sam}` }).click();
  await expect(page.getByText(`${sam} can't open the store any more.`)).toBeVisible();
  await expect(page.getByRole("article", { name: sam })).toHaveCount(0);
});

test("a restock order made in the app and counted in as it arrives", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `rs${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Wrap");
  await web.getByLabel("Price", { exact: true }).fill("9.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Restock orders/ }).click();
  await expect(page.getByText("No restock orders yet")).toBeVisible();
  await page.getByRole("button", { name: "New restock order" }).click();
  await page.getByRole("textbox", { name: "Supplier", exact: true }).fill("Hive Co");
  await page.getByRole("textbox", { name: "Find an option" }).fill("beeswax");
  await page.getByRole("textbox", { name: "How many Beeswax Wrap" }).fill("10");
  await page.getByRole("textbox", { name: "Cost each of Beeswax Wrap" }).fill("2.50");
  await shot(page, "365-app-restock-new");
  await page.getByRole("button", { name: "Save restock order" }).click();

  await expect(page.getByRole("heading", { name: "Restock order #1", level: 1 })).toBeVisible();
  await expect(page.getByText("Restock order #1 is saved. Count it in here when it arrives.")).toBeVisible();
  await expect(page.getByText(/^0 of 10 in · \$25\.00/)).toBeVisible();

  // Four come first, the rest later.
  await page.getByRole("button", { name: "Some of it arrived…" }).click();
  await page.getByRole("textbox", { name: "Arrived of Beeswax Wrap" }).fill("4");
  await page.getByRole("button", { name: "Add what arrived to stock" }).click();
  await expect(page.getByText("Added 4 to your stock. The rest is still on the way.")).toBeVisible();
  await expect(page.getByText("4 of 10 in · $2.50 each")).toBeVisible();
  await page.getByRole("button", { name: "Everything arrived" }).click();
  await expect(page.getByText("Added 6 to your stock. Everything on this order is in.")).toBeVisible();
  await expect(page.getByText("Arrived", { exact: true })).toBeVisible();

  await web.reload();
  await expect(web.getByLabel("Stock", { exact: true })).toHaveValue("16");
});

test("a stock count from the app sets what's really on the shelf", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `ct${Date.now()}`);
  for (const [title, stock] of [["Olive Soap", "3"], ["Lavender Soap", "6"]]) {
    await web.goto(`${WEB}/admin/products/new`);
    await web.getByLabel("Title").fill(title!);
    await web.getByLabel("Price", { exact: true }).fill("7.00");
    await web.getByLabel("Stock", { exact: true }).fill(stock!);
    await web.getByRole("button", { name: "Save product" }).click();
    await expect(web.getByText("Product added.")).toBeVisible();
  }

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Count stock/ }).click();
  await expect(page.getByRole("heading", { name: "Count stock", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Find by name, SKU, shelf or barcode" }).fill("laven");
  await expect(page.getByRole("group", { name: "Olive Soap" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Lavender Soap" }).getByText("6 expected")).toBeVisible();
  await page.getByRole("textbox", { name: "Counted Lavender Soap" }).fill("4");
  await expect(page.getByText("2 missing.")).toBeVisible();
  await shot(page, "366-app-stock-count");
  await page.getByRole("button", { name: "Save the count (1 change)" }).click();
  await expect(page.getByText("Updated 1 option. 2 fewer than expected.")).toBeVisible();

  // The website shows the counted stock; the soap left alone keeps its own.
  await web.reload();
  await expect(web.getByLabel("Stock", { exact: true })).toHaveValue("4");
});

test("a supplier price rise raised from the app, and the price watch set there", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pc${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Price changes/ }).click();
  await expect(page.getByRole("heading", { name: "Price changes", level: 1 })).toBeVisible();
  await expect(page.getByText("No supplier has raised a price.")).toBeVisible();

  // A margin the store can't use is turned down; a real one is saved.
  const watch = page.getByRole("region", { name: "Price watch" });
  await watch.getByRole("textbox", { name: "Warn me below this margin (%)" }).fill("95");
  await watch.getByRole("button", { name: "Save price watch" }).click();
  await expect(page.getByText("Use a margin from 0% to 90%.")).toBeVisible();
  await watch.getByRole("textbox", { name: "Warn me below this margin (%)" }).fill("25");
  await watch.getByRole("button", { name: "Save price watch" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  // Test mode: the supplier now charges 90% of the price.
  await page.getByRole("button", { name: /^Simulate a supplier price rise for/ }).click();
  const rise = page.getByRole("group", { name: /sunset projection lamp/i });
  await expect(rise.getByText(/Margin \d+% → 10%, below your 25%/)).toBeVisible();
  await shot(page, "367-app-price-rise");
  await rise.getByRole("button", { name: /^Raise to \$/ }).click();
  await expect(page.getByText(/^Price raised to \$/)).toBeVisible();
  await expect(page.getByText("No supplier has raised a price.")).toBeVisible();
  await expect(page.getByText("Price raised", { exact: true })).toBeVisible();

  // The website shows it dealt with.
  await web.goto(`${WEB}/admin/price-changes`);
  await expect(web.getByRole("list", { name: "Price rises dealt with" }).getByRole("listitem").first()).toContainText("Price raised");
});

test("a supplier of your own added, changed and removed from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sp${Date.now()}`);
  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Suppliers/ }).click();
  await expect(page.getByRole("heading", { name: "Suppliers", level: 1 })).toBeVisible();
  await expect(page.getByText("None yet")).toBeVisible();

  await page.getByRole("textbox", { name: "Supplier name" }).fill("Northwind Wholesale");
  await page.getByRole("textbox", { name: "Supplier email" }).fill("orders@northwind.example");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByText(/^Northwind Wholesale added\./)).toBeVisible();
  const card = page.getByRole("group", { name: "Northwind Wholesale" });
  await expect(card.getByText("orders@northwind.example · 0 products")).toBeVisible();
  await shot(page, "368-app-suppliers");

  // The same email can't be added twice.
  await page.getByRole("textbox", { name: "Supplier name" }).fill("Northwind Again");
  await page.getByRole("textbox", { name: "Supplier email" }).fill("orders@northwind.example");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByText("Northwind Wholesale already uses orders@northwind.example.")).toBeVisible();

  await card.getByRole("button", { name: "Change Northwind Wholesale" }).click();
  await card.getByRole("textbox", { name: "Email" }).fill("sales@northwind.example");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Northwind Wholesale saved.")).toBeVisible();
  await expect(card.getByText(/^sales@northwind\.example/)).toBeVisible();

  await card.getByRole("button", { name: "Give Northwind Wholesale a new link" }).click();
  await expect(page.getByText("Northwind Wholesale has a new link.", { exact: false })).toBeVisible();

  // The website lists it too.
  await web.goto(`${WEB}/admin/suppliers`);
  await expect(web.getByText("sales@northwind.example").first()).toBeVisible();

  await card.getByRole("button", { name: "Remove Northwind Wholesale…" }).click();
  await page.getByRole("button", { name: "Remove Northwind Wholesale", exact: true }).click();
  await expect(page.getByText("Northwind Wholesale removed.")).toBeVisible();
  await expect(page.getByText("None yet")).toBeVisible();
});

test("a cart link made in the app fills a shopper's cart", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `cl${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();

  await signIn(page, email);
  await page.getByRole("button", { name: "Cart links" }).click();
  await expect(page.getByRole("heading", { name: "Cart links", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Link name" }).fill("Story bundle");
  await page.getByRole("textbox", { name: "Add a product" }).fill("sunset");
  await page.getByRole("button", { name: /^Add Sunset Projection Lamp/ }).first().click();
  const line = page.getByRole("group", { name: /^In the cart: Sunset Projection Lamp/ });
  await line.getByRole("button", { name: /^One more/ }).click();
  await expect(line.getByText("2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Make the link" }).click();
  await expect(page.getByText("“Story bundle” is ready. Share it anywhere.")).toBeVisible();
  const card = page.getByRole("group", { name: "Story bundle" });
  await expect(card.getByText("0 clicks · 0 orders", { exact: false })).toBeVisible();
  await expect(card.getByText(/^2 × Sunset Projection Lamp/)).toBeVisible();
  await shot(page, "369-app-cart-links");

  // A shopper opening the link gets the lamps in their cart.
  await web.goto(`${WEB}/admin/cart-links`);
  const url = await web.getByLabel("Link for Story bundle").inputValue();
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(url);
  await expect(buyer).toHaveURL(/\/cart\?utm_source=link-story-bundle/);
  await expect(buyer.getByRole("link", { name: /^Cart, 2 items/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("group", { name: "Story bundle" }).getByText(/^1 click · 0 orders/)).toBeVisible();
  await page.getByRole("button", { name: "Delete Story bundle…" }).click();
  await page.getByRole("button", { name: "Delete Story bundle", exact: true }).click();
  await expect(page.getByText("“Story bundle” deleted.", { exact: false })).toBeVisible();
  await expect(page.getByRole("group", { name: "Story bundle" })).toHaveCount(0);
});

test("a wholesale application answered from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `ws${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Brass Lamp");
  await web.getByLabel("Price", { exact: true }).fill("40.00");
  await web.getByLabel("Stock", { exact: true }).fill("20");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const store = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href.replace(/\/products\/.*$/, "");

  await signIn(page, email);
  await page.getByRole("button", { name: "Customers" }).click();
  await page.getByRole("link", { name: /^Wholesale/ }).click();
  await expect(page.getByText("Wholesale is off", { exact: false })).toBeVisible();
  await page.getByRole("switch", { name: "Sell wholesale" }).click();
  await page.getByRole("textbox", { name: "Wholesale discount (%)" }).fill("25");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Wholesale settings saved.")).toBeVisible();

  // A shop signs in on the store and applies.
  const buyer = await (await browser.newContext()).newPage();
  const shopEmail = `corner-${Date.now()}@example.com`;
  await buyer.goto(`${store}/account`);
  await buyer.getByLabel("Email").fill(shopEmail);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  await expect(buyer.getByRole("status")).toContainText("We sent a 6-digit code");
  const inbox = await buyer.context().newPage();
  await inbox.goto(`${WEB}/dev/mail`);
  const subject = await inbox.getByRole("article").filter({ hasText: shopEmail }).first().getByRole("heading").textContent();
  await inbox.close();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();
  const apply = buyer.getByRole("region", { name: "Buying for a business?" });
  await apply.getByLabel("Business name").fill("Corner Shop");
  await apply.getByLabel("What do you sell, and where? (optional)").fill("Gifts and lighting, two shops in Austin.");
  await apply.getByRole("button", { name: "Apply for wholesale" }).click();
  await expect(apply.getByRole("status")).toContainText("is looking at your application for Corner Shop");

  await page.reload();
  await expect(page.getByRole("region", { name: "Applications (1)" })).toBeVisible();
  const application = page.getByRole("group", { name: "Corner Shop" });
  await expect(application.getByText("Gifts and lighting, two shops in Austin.")).toBeVisible();
  await shot(page, "370-app-wholesale");
  await application.getByRole("button", { name: "Approve Corner Shop" }).click();
  await expect(page.getByText("Corner Shop is approved. We emailed them.")).toBeVisible();
  await expect(page.getByText("No applications waiting")).toBeVisible();

  // A buyer the merchant already knows, added by hand; then wholesale taken away from the shop.
  await page.getByRole("textbox", { name: "Buyer's email" }).fill("orders@bigstore.example");
  await page.getByRole("textbox", { name: "Business name (optional)" }).fill("Big Store");
  await page.getByRole("button", { name: "Add wholesale buyer" }).click();
  await expect(page.getByText("Big Store gets wholesale prices once they sign in.")).toBeVisible();
  await page.getByRole("button", { name: "Remove Corner Shop…" }).click();
  await page.getByRole("button", { name: "Remove Corner Shop", exact: true }).click();
  await expect(page.getByText("Corner Shop pays the normal prices again.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Corner Shop" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Big Store" })).toBeVisible();

  await web.goto(`${WEB}/admin/wholesale`);
  await expect(web.getByRole("region", { name: "Wholesale buyers" }).getByText("Big Store")).toBeVisible();
});

test("a partner added from the app gets their code, and is paused and brought back", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pt${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("button", { name: "Partners" }).click();
  await expect(page.getByRole("heading", { name: "Partners", level: 1 })).toBeVisible();
  await expect(page.getByText("No partners yet")).toBeVisible();

  const maya = `maya-${Date.now()}@example.com`;
  await page.getByRole("textbox", { name: "Their name" }).fill("Maya Lamps");
  await page.getByRole("textbox", { name: "Their email (optional)" }).fill(maya);
  await page.getByRole("textbox", { name: "Their code" }).fill("maya15");
  await page.getByRole("textbox", { name: "Buyers get (% off)" }).fill("15");
  await page.getByRole("textbox", { name: "They get (% of items sold)" }).fill("7.5");
  await page.getByRole("button", { name: "Add partner" }).click();
  await expect(page.getByText("Maya Lamps is a partner with the code MAYA15. We emailed them their code and private page.")).toBeVisible();
  const card = page.getByRole("group", { name: "Maya Lamps" });
  await expect(card.getByText(`Code MAYA15 · buyers get 15% off · they get 7.5% · ${maya}`)).toBeVisible();
  await expect(card.getByText("Owed $0.00", { exact: false })).toBeVisible();
  await expect(card.getByRole("button", { name: "Share Maya Lamps's code link" })).toBeVisible();
  await shot(page, "371-app-partners");

  const mail = await web.context().newPage();
  await mail.goto(`${WEB}/dev/mail`);
  await expect(mail.getByRole("article").filter({ hasText: maya }).filter({ hasText: "MAYA15" }).first()).toBeVisible();
  await mail.close();

  await card.getByRole("button", { name: "Pause Maya Lamps" }).click();
  await expect(page.getByText("Maya Lamps is paused, so their code stops working. What they earned stays.")).toBeVisible();
  await expect(card.getByText("Paused", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Bring back Maya Lamps" }).click();
  await expect(page.getByText("Maya Lamps's code works again.")).toBeVisible();
  await card.getByRole("button", { name: "Make a new private link for Maya Lamps" }).click();
  await expect(page.getByText("Maya Lamps has a new private link.", { exact: false })).toBeVisible();

  await web.goto(`${WEB}/admin/partners`);
  await expect(web.getByRole("article", { name: "Maya Lamps" })).toContainText("MAYA15");
});

test("an email campaign written, tested and sent from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `ec${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  // A buyer who says yes to emails at checkout.
  const buyer = await (await browser.newContext()).newPage();
  const fan = `fan-${Date.now()}@example.com`;
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(fan);
  await buyer.getByLabel("Send me news and offers").check();
  await buyer.getByLabel("Full name").fill("Ada Fan");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await signIn(page, email);
  await page.getByRole("button", { name: "Email campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Email campaigns", level: 1 })).toBeVisible();
  await expect(page.getByText("1 subscriber ·", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "Mailing address" }).fill("PO Box 12, Austin, TX 78701, USA");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Mailing address saved.", { exact: false })).toBeVisible();

  await page.getByRole("textbox", { name: "Subject" }).fill("Lamp news");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("Our sunset lamps are back in stock.");
  await page.getByRole("textbox", { name: "Button text (optional)" }).fill("See the lamps");
  await page.getByRole("textbox", { name: "Button goes to (optional)" }).fill("/products");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved. Send yourself a test, then send it.")).toBeVisible();
  const draft = page.getByRole("group", { name: "Lamp news" });
  await draft.getByRole("button", { name: "Send me a test of Lamp news" }).click();
  await expect(page.getByText(`Test sent to ${email}.`)).toBeVisible();
  await shot(page, "372-app-campaigns");

  await draft.getByRole("button", { name: "Send Lamp news…" }).click();
  await draft.getByRole("button", { name: "Send to 1 person" }).click();
  await expect(page.getByText("Sending to 1 person.", { exact: false })).toBeVisible();
  await expect(page.getByRole("group", { name: "Lamp news" }).getByText(/^(Sending|Sent)$/)).toBeVisible();

  const mail = await web.context().newPage();
  await mail.goto(`${WEB}/dev/mail`);
  await expect(async () => {
    await mail.reload();
    await expect(mail.getByRole("article").filter({ hasText: fan }).filter({ hasText: "Lamp news" }).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await mail.close();
});

test("the buyer survey set up in the app, and what a buyer answered", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sv${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Linen Towel");
  await web.getByLabel("Price", { exact: true }).fill("15.00");
  await web.getByLabel("Stock", { exact: true }).fill("5");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const towel = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await page.getByRole("link", { name: /^How buyers found you/ }).click();
  await expect(page.getByRole("heading", { name: "Buyer survey", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Set up the question" }).click();
  await page.getByRole("textbox", { name: "Answers, one per line" }).fill("Instagram\nA friend");
  await page.getByRole("button", { name: "Start asking" }).click();
  await expect(page.getByText("Saved. Buyers see the question on their order page right after paying.")).toBeVisible();
  await expect(page.getByText("Instagram · A friend · or their own words")).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(towel);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${Date.now()}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const question = buyer.getByRole("region", { name: "How did you hear about us?" });
  await question.getByRole("radio", { name: "Other" }).check();
  await question.getByLabel("Tell us where").fill("A newsletter");
  await question.getByRole("button", { name: "Send answer" }).click();
  await expect(buyer.getByRole("region", { name: "How did you hear about us?" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("1 of 1 order answered (100%).")).toBeVisible();
  await expect(page.getByRole("region", { name: "What buyers said" }).getByText("1 order · 100%")).toBeVisible();
  await expect(page.getByRole("region", { name: "In their own words" }).getByText("A newsletter")).toBeVisible();
  await shot(page, "373-app-survey");

  await page.getByRole("button", { name: "Stop asking" }).click();
  await expect(page.getByText("The survey is off. Answers so far stay here.")).toBeVisible();
  await expect(page.getByText("Not asking yet")).toBeVisible();
});

test("rewards turned on in the app, and points added to a buyer", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `rw${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Wool Socks");
  await web.getByLabel("Price", { exact: true }).fill("20.00");
  await web.getByLabel("Stock", { exact: true }).fill("9");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const socks = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await page.getByRole("button", { name: "Rewards" }).click();
  await expect(page.getByRole("heading", { name: "Rewards", level: 1 })).toBeVisible();
  await page.getByRole("switch", { name: "Give reward points" }).click();
  await page.getByRole("textbox", { name: "Points per $1.00 spent" }).fill("5");
  await page.getByRole("button", { name: "Save rewards" }).click();
  await expect(page.getByText("Rewards saved. Buyers earn points from their next order.")).toBeVisible();
  await expect(page.getByText("No one has points yet")).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(socks);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`grace-${Date.now()}@example.com`);
  await buyer.getByLabel("Full name").fill("Grace Hopper");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();

  await page.reload();
  const holder = page.getByRole("link", { name: /^Grace Hopper/ });
  await expect(holder).toContainText("100 points");
  await shot(page, "374-app-rewards");
  await holder.click();
  const points = page.getByRole("region", { name: "Reward points" });
  await expect(points.getByText("100", { exact: true })).toBeVisible();
  await points.getByRole("textbox", { name: "Points to add" }).fill("50");
  await points.getByRole("textbox", { name: "Note they see" }).fill("Sorry about the late parcel");
  await points.getByRole("button", { name: "Save points" }).click();
  await expect(page.getByText("Saved. They have 150 points now.")).toBeVisible();
});

test("bank transfers turned on in the app, and a transfer marked paid", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `bt${Date.now()}`);
  await web.goto(`${WEB}/admin/plan`);
  await web.getByRole("button", { name: "Upgrade to Growth" }).click();
  await expect(web.getByRole("heading", { name: "You're on Growth" })).toBeVisible();
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Oak Shelf");
  await web.getByLabel("Price", { exact: true }).fill("120.00");
  await web.getByLabel("Stock", { exact: true }).fill("3");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const shelf = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await tab(page, "Orders");
  await page.getByRole("link", { name: /^Bank transfers/ }).click();
  await expect(page.getByRole("heading", { name: "Bank transfers", level: 1 })).toBeVisible();
  await expect(page.getByText("No transfers to look for")).toBeVisible();
  await page.getByRole("switch", { name: "Let buyers pay by bank transfer" }).click();
  await page.getByRole("textbox", { name: "Account to pay into" }).fill("Shelf Co Ltd\nIBAN DE89 3704 0044 0532 0130 00");
  await page.getByRole("textbox", { name: "Days to pay" }).fill("5");
  await page.getByRole("button", { name: "Save bank transfers" }).click();
  await expect(page.getByText("Saved. Buyers can now pay by bank transfer on the payment page.")).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(shelf);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${Date.now()}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: "Pay by bank transfer" }).click();
  await expect(buyer.locator("#transfer").getByText("IBAN DE89 3704 0044 0532 0130 00")).toBeVisible();

  await page.reload();
  const waiting = page.getByRole("link", { name: "Order #1001" });
  await expect(waiting).toContainText("Ada Lovelace");
  await expect(waiting).toContainText("Due ");
  await shot(page, "375-app-bank-transfers");
  await waiting.click();
  const transfer = page.getByRole("region", { name: "Bank transfer" });
  await expect(transfer.getByText("Waiting for a bank transfer")).toBeVisible();
  await transfer.getByRole("button", { name: "Mark as paid…" }).click();
  await transfer.getByRole("button", { name: "Mark as paid", exact: true }).click();
  await expect(page.getByText("Marked as paid. It goes to the supplier now, and the buyer gets their confirmation.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Bank transfer" })).toHaveCount(0);
});

test("pre-orders and purchase limits set on a product in the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `po${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Linen Throw");
  await web.getByLabel("Price", { exact: true }).fill("60.00");
  await web.getByLabel("Stock", { exact: true }).fill("0");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const throwUrl = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Linen Throw/ }).click();
  const pre = page.getByRole("region", { name: "Pre-orders" });
  await pre.getByRole("switch", { name: "Take pre-orders when sold out" }).click();
  // Too far ahead is refused, as on the website.
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await pre.getByRole("textbox", { name: "Ships by" }).fill(day(200));
  await pre.getByRole("button", { name: "Save pre-orders" }).click();
  await expect(page.getByText("Pre-orders can promise up to 120 days ahead.")).toBeVisible();
  const shipsBy = day(30);
  await pre.getByRole("textbox", { name: "Ships by" }).fill(shipsBy);
  await pre.getByRole("textbox", { name: "Most pre-orders (optional)" }).fill("20");
  await pre.getByRole("button", { name: "Save pre-orders" }).click();
  await expect(page.getByText("Saved. Sold-out options can now be pre-ordered.")).toBeVisible();
  const short = new Date(`${shipsBy}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  await expect(pre.getByText(`0 pre-ordered so far of 20, shipping by ${short}.`)).toBeVisible();

  const limits = page.getByRole("region", { name: "Purchase limits" });
  await limits.getByRole("textbox", { name: "Most per order" }).fill("2");
  await limits.getByRole("button", { name: "Save limits" }).click();
  await expect(page.getByText("Saved. The cart and checkout now follow these limits.")).toBeVisible();
  await shot(page, "376-app-preorders-limits");

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(throwUrl);
  const long = new Date(`${shipsBy}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  await expect(buyer.getByText(`Pre-order: ships by ${long}`)).toBeVisible();
  await expect(buyer.getByText("Up to 2 per order")).toBeVisible();
});

test("saved replies written in the app, and used in a conversation", async ({ page, browser }) => {
  const id = `sr${Date.now()}`;
  const { email } = await merchant(browser, id);
  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(`${WEB}/s/pocket-shop-${id}/contact`);
  await buyer.getByLabel("Your name").fill("Grace Hopper");
  await buyer.getByLabel("Email").fill(`grace-${id}@example.com`);
  await buyer.getByLabel("Message").fill("Do your lamps work with UK plugs?");
  await buyer.getByRole("button", { name: "Send message" }).click();
  await expect(buyer.getByText("Thanks, your message is on its way.")).toBeVisible();

  await signIn(page, email);
  await page.getByRole("button", { name: "Buyer inbox" }).click();
  await page.getByRole("link", { name: /^Saved replies/ }).click();
  await expect(page.getByRole("heading", { name: "Saved replies", level: 1 })).toBeVisible();
  await expect(page.getByText("No saved replies yet")).toBeVisible();
  await page.getByRole("button", { name: "Add replies to start from" }).click();
  await expect(page.getByText("Added 3 replies to start from. Change them to sound like you.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Where is my order" })).toBeVisible();

  await page.getByRole("textbox", { name: "Name" }).fill("UK plugs");
  await page.getByRole("textbox", { name: "Reply" }).fill("Hi {first_name}, every lamp from {store_name} comes with a UK plug.");
  await page.getByRole("button", { name: "Save reply" }).click();
  await expect(page.getByText('Saved "UK plugs".')).toBeVisible();

  await page.getByRole("button", { name: "Delete Returns…" }).click();
  await page.getByRole("button", { name: "Delete Returns", exact: true }).click();
  await expect(page.getByText("Deleted.", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Returns" })).toHaveCount(0);
  await expect(page.getByText("Your replies (3 of 30)")).toBeVisible();
  await shot(page, "377-app-saved-replies");

  await page.getByRole("link", { name: "Inbox" }).click();
  await page.getByText("Message from Grace Hopper").filter({ visible: true }).click();
  await page.getByRole("button", { name: "UK plugs" }).click();
  await expect(page.getByRole("textbox", { name: "Your reply" })).toHaveValue(/^Hi Grace, every lamp from Pocket Shop .* comes with a UK plug\.$/);
});

test("a bundle made in the app shows on the store, then switched off", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `bn${Date.now()}`);
  const add = async (title: string, price: string) => {
    await web.goto(`${WEB}/admin/products/new`);
    await web.getByLabel("Title").fill(title);
    await web.getByLabel("Price", { exact: true }).fill(price);
    await web.getByLabel("Stock", { exact: true }).fill("9");
    await web.getByRole("button", { name: "Save product" }).click();
    await expect(web.getByText("Product added.")).toBeVisible();
    return new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  };
  const lamp = await add("Desk Lamp", "40.00");
  await add("Warm Bulbs", "10.00");

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Bundles/ }).click();
  await expect(page.getByRole("heading", { name: "Bundles", level: 1 })).toBeVisible();
  await expect(page.getByText("No bundles yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill("Reading set");
  await page.getByRole("textbox", { name: "Discount (%)" }).fill("20");
  const picks = page.getByRole("group", { name: "Products in the bundle" });
  await picks.getByRole("switch", { name: "Desk Lamp" }).click();
  await picks.getByRole("switch", { name: "Warm Bulbs" }).click();
  await page.getByRole("button", { name: "Add bundle" }).click();
  await expect(page.getByText("Bundle added. It shows on each of its products' pages.")).toBeVisible();
  const set = page.getByRole("group", { name: "Reading set" });
  await expect(set).toContainText("20% off Desk Lamp + Warm Bulbs");
  await expect(set).toContainText("On your store");
  await shot(page, "378-app-bundles");

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(lamp);
  await expect(buyer.getByRole("region", { name: "Buy together, save 20%" })).toBeVisible();

  await set.getByRole("button", { name: "Switch off Reading set" }).click();
  await expect(page.getByText("Bundle switched off. It's hidden from your store.")).toBeVisible();
  await expect(set).toContainText("Off");
  await buyer.reload();
  await expect(buyer.getByRole("heading", { name: "Desk Lamp" })).toBeVisible();
  await expect(buyer.getByRole("region", { name: "Buy together, save 20%" })).toHaveCount(0);
});

test("tag rules added in the app tag the buyers who match", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `tr${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Wool Scarf");
  await web.getByLabel("Price", { exact: true }).fill("45.00");
  await web.getByLabel("Stock", { exact: true }).fill("9");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const scarf = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(scarf);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`grace-${Date.now()}@example.com`);
  await buyer.getByLabel("Full name").fill("Grace Hopper");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();

  await signIn(page, email);
  await page.getByRole("button", { name: "Customers" }).click();
  await page.getByRole("link", { name: /^Tag customers automatically/ }).click();
  await expect(page.getByRole("heading", { name: "Tag customers automatically", level: 1 })).toBeVisible();
  await expect(page.getByText("No rules yet")).toBeVisible();

  await page.getByRole("textbox", { name: "Spent at least" }).fill("40.00");
  await page.getByRole("textbox", { name: "Get the tag" }).fill("VIP");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Added. 1 customer now has the tag “vip”.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Spent $40.00 or more: vip" })).toContainText("1 customer has the tag now");

  await page.getByRole("tab", { name: "Bought" }).click();
  await page.getByRole("textbox", { name: "Find a product" }).fill("scarf");
  await page.getByRole("button", { name: "Pick Wool Scarf" }).click();
  await page.getByRole("textbox", { name: "Get the tag" }).fill("scarves");
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Added. 1 customer now has the tag “scarves”.")).toBeVisible();
  await expect(page.getByText("Your rules (2 of 20)")).toBeVisible();
  await shot(page, "379-app-tag-rules");

  await page.getByRole("button", { name: "Remove the vip rule…" }).click();
  await page.getByRole("button", { name: "Remove the vip rule", exact: true }).click();
  await expect(page.getByText("Removed. Customers it tagged lose “vip”, unless you gave it by hand.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Spent $40.00 or more: vip" })).toHaveCount(0);
});

test("one-time codes made in the app, used once, then turned off", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `cb${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Clay Mug");
  await web.getByLabel("Price", { exact: true }).fill("30.00");
  await web.getByLabel("Stock", { exact: true }).fill("9");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const mug = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await page.getByRole("button", { name: "Discount codes" }).click();
  await page.getByRole("link", { name: /^One-time codes/ }).click();
  await expect(page.getByRole("heading", { name: "One-time codes", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill("Parcel cards");
  await page.getByRole("textbox", { name: "Codes start with" }).fill("thanks");
  await page.getByRole("textbox", { name: "How many codes" }).fill("3");
  await page.getByRole("textbox", { name: "Percent off" }).fill("15");
  await page.getByRole("button", { name: "Make the codes" }).click();
  await expect(page.getByText("Made 3 codes. Each one works once.")).toBeVisible();
  const batch = page.getByRole("group", { name: "Parcel cards" });
  await expect(batch).toContainText("15% off · THANKS-…");
  await expect(batch).toContainText("0 of 3 used");
  await batch.getByRole("button", { name: "See the Parcel cards codes" }).click();
  const first = batch.getByText(/^THANKS-[A-Z2-9]{8}$/).first();
  const code = (await first.textContent())!;
  await expect(batch.getByText("Not used")).toHaveCount(3);
  await shot(page, "380-app-one-time-codes");

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(mug);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByLabel("Discount or gift card code").fill(code.toLowerCase());
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText(`Discount (${code})`)).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${Date.now()}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.reload();
  const again = page.getByRole("group", { name: "Parcel cards" });
  await expect(again).toContainText("1 of 3 used");
  await again.getByRole("button", { name: "See the Parcel cards codes" }).click();
  await expect(again.getByText("Used on #1001")).toBeVisible();
  await again.getByRole("button", { name: "Turn off Parcel cards" }).click();
  await expect(page.getByText("Parcel cards codes are off. Codes already used stay used.")).toBeVisible();
  await expect(again).toContainText("Off");
});

test("shipping paused from the app, shown on the store, then ended", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sp${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Paper Lantern");
  await web.getByLabel("Price", { exact: true }).fill("25.00");
  await web.getByLabel("Stock", { exact: true }).fill("9");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const lantern = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Shipping pause/ }).click();
  await expect(page.getByRole("heading", { name: "Shipping pause", level: 1 })).toBeVisible();
  await page.getByRole("switch", { name: "Pause shipping" }).click();
  const resumes = new Date(Date.now() + 10 * 86_400_000);
  await page.getByRole("textbox", { name: "Ships again on" }).fill(resumes.toISOString().slice(0, 10));
  await page.getByRole("textbox", { name: "Message for buyers (optional)" }).fill("Our supplier is closed for New Year.");
  await page.getByRole("button", { name: "Save shipping pause" }).click();
  await expect(page.getByText("Saved. Your store says when orders ship again, and delivery dates move to match.")).toBeVisible();
  const short = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(resumes);
  await expect(page.getByText(`Paused until ${short}`)).toBeVisible();
  await shot(page, "381-app-ship-pause");

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(lantern);
  const long = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(resumes);
  await expect(buyer.locator("#ship-pause")).toHaveText(`Shipping is paused for a few days. Orders placed now ship from ${long}, and delivery dates count from then.`);
  await expect(buyer.getByText("Our supplier is closed for New Year.")).toBeVisible();

  await page.getByRole("switch", { name: "Pause shipping" }).click();
  await page.getByRole("button", { name: "Save shipping pause" }).click();
  await expect(page.getByText("Shipping pause ended. Delivery dates are back to normal.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("heading", { name: "Paper Lantern" })).toBeVisible();
  await expect(buyer.locator("#ship-pause")).toHaveCount(0);
});

test("running late emails turned on from the app", async ({ page, browser }) => {
  const { email } = await merchant(browser, `le${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Running late emails/ }).click();
  await expect(page.getByRole("heading", { name: "Running late emails", level: 1 })).toBeVisible();
  await page.getByRole("switch", { name: "Email buyers when an order is running late" }).click();
  await page.getByRole("tab", { name: "7 days" }).click();
  await page.getByRole("textbox", { name: "Your own words (optional)" }).fill("Our handmade pieces take a little longer this month.");
  await page.getByRole("switch", { name: "Also email when a shipped parcel is past its delivery date" }).click();
  await page.getByRole("button", { name: "Save running late emails" }).click();
  await expect(page.getByText("Saved. Buyers hear from you once if their order hasn't shipped after 7 days.")).toBeVisible();
  await shot(page, "382-app-late-emails");

  await page.reload();
  await expect(page.getByRole("tab", { name: "7 days" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "Your own words (optional)" })).toHaveValue("Our handmade pieces take a little longer this month.");
  await expect(page.getByRole("switch", { name: "Also email when a shipped parcel is past its delivery date" })).toBeChecked();
  await page.getByRole("switch", { name: "Email buyers when an order is running late" }).click();
  await page.getByRole("button", { name: "Save running late emails" }).click();
  await expect(page.getByText("Running late emails are off.")).toBeVisible();
});

test("a holiday order-by date set from the app shows on product pages", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `hd${Date.now()}`);
  // A supplier's product has delivery dates to count back from.
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();
  const stocking = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Holiday order-by date/ }).click();
  await expect(page.getByRole("heading", { name: "Holiday order-by date", level: 1 })).toBeVisible();
  await page.getByRole("switch", { name: "Show an order-by date for a holiday" }).click();
  await expect(page.getByRole("textbox", { name: "Holiday" })).toHaveValue("Christmas");
  const arrive = new Date(Date.now() + 60 * 86_400_000);
  await page.getByRole("textbox", { name: "Must arrive by" }).fill(arrive.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Save holiday date" }).click();
  const short = arrive.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  await expect(page.getByText(`Saved. Product pages say when to order for Christmas, arriving by ${short}.`)).toBeVisible();
  await shot(page, "383-app-holiday-date");

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(stocking);
  await expect(buyer.locator("#holiday-deadline")).toHaveText(/^Order by [A-Z][a-z]{2} \d{1,2} to get it in time for Christmas\.$/);

  await page.getByRole("switch", { name: "Show an order-by date for a holiday" }).click();
  await page.getByRole("button", { name: "Save holiday date" }).click();
  await expect(page.getByText("Removed. Product pages no longer give an order-by date.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("heading", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await expect(buyer.locator("#holiday-deadline")).toHaveCount(0);
});

test("product tags set in the app, picked from the store's other tags", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pt${Date.now()}`);
  for (const title of ["Straw Hat", "Beach Towel", "Wool Gloves"]) {
    await web.goto(`${WEB}/admin/products/new`);
    await web.getByLabel("Title").fill(title);
    await web.getByLabel("Price", { exact: true }).fill("20.00");
    await web.getByLabel("Stock", { exact: true }).fill("9");
    await web.getByRole("button", { name: "Save product" }).click();
    await expect(web.getByText("Product added.")).toBeVisible();
  }

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Straw Hat/ }).click();
  const tags = page.getByRole("region", { name: "Tags" });
  await tags.getByRole("textbox", { name: "Tags" }).fill("Summer, Gift idea");
  await tags.getByRole("button", { name: "Save tags" }).click();
  await expect(page.getByText("Tags saved.")).toBeVisible();
  await expect(tags.getByRole("textbox", { name: "Tags" })).toHaveValue("summer, gift idea");

  await page.getByRole("link", { name: "Products" }).filter({ visible: true }).first().click();
  await page.getByRole("link", { name: /^Beach Towel/ }).filter({ visible: true }).click();
  const towel = page.getByRole("region", { name: "Tags" }).filter({ visible: true });
  await towel.getByRole("button", { name: "Add the tag summer" }).click();
  await expect(towel.getByRole("textbox", { name: "Tags" })).toHaveValue("summer");
  await towel.getByRole("button", { name: "Save tags" }).click();
  await expect(page.getByText("Tags saved.").filter({ visible: true })).toBeVisible();
  await shot(page, "384-app-product-tags");

  // The website's product list filters by them.
  await web.goto(`${WEB}/admin/products?tag=summer`);
  await expect(web.getByRole("link", { name: "Straw Hat" })).toBeVisible();
  await expect(web.getByRole("link", { name: "Beach Towel" })).toBeVisible();
  await expect(web.getByRole("link", { name: "Wool Gloves" })).toHaveCount(0);
});

test("a product put in and taken out of collections from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pc${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Straw Hat");
  await web.getByLabel("Price", { exact: true }).fill("20.00");
  await web.getByLabel("Stock", { exact: true }).fill("9");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  await web.goto(`${WEB}/admin/collections/new`);
  await web.getByLabel("Title").fill("Summer picks");
  await web.getByRole("button", { name: "Save collection" }).click();
  await expect(web.getByText("Saved.")).toBeVisible();
  await web.goto(`${WEB}/admin/collections/new`);
  await web.getByLabel("Title").fill("Hats");
  await web.getByLabel(/By rules/).check();
  await web.getByRole("region", { name: "Rules" }).getByLabel("Word 1").fill("hat");
  await web.getByRole("button", { name: "Save collection" }).click();
  await expect(web.getByText("Saved.")).toBeVisible();

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Straw Hat/ }).click();
  const section = page.getByRole("region", { name: "Collections" });
  await expect(section.getByRole("group", { name: "Automatic collections" })).toContainText("Hats");
  await expect(section.getByRole("group", { name: "Automatic collections" })).toContainText("In it");
  const summer = section.getByRole("switch", { name: "Summer picks" });
  await expect(summer).not.toBeChecked();
  await summer.click();
  await expect(page.getByText("Added to Summer picks.")).toBeVisible();
  await expect(summer).toBeChecked();
  await shot(page, "385-app-product-collections");

  await web.goto(`${WEB}/admin/collections`);
  await expect(web.getByRole("row", { name: /Summer picks/ })).toContainText("1");

  await summer.click();
  await expect(page.getByText("Taken out of Summer picks.")).toBeVisible();
  await expect(summer).not.toBeChecked();
  await web.reload();
  await expect(web.getByRole("row", { name: /Summer picks/ })).toContainText("0");
});

test("collections made, filled and deleted from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `cl${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Straw Hat");
  await web.getByLabel("Price", { exact: true }).fill("20.00");
  await web.getByLabel("Stock", { exact: true }).fill("9");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Collections/ }).click();
  await expect(page.getByText("No collections yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill("Summer picks");
  await page.getByRole("button", { name: "Make collection" }).click();
  await expect(page.getByText("Made Summer picks. To fill it, open a product and switch it on under Collections.")).toBeVisible();
  const card = page.getByRole("group", { name: "Summer picks" });
  await expect(card).toContainText("0 products");
  await expect(card).toContainText("Hand-picked");

  // Fill it from the product's screen, then come back.
  await page.getByRole("link", { name: "Products" }).filter({ visible: true }).first().click();
  await page.getByRole("link", { name: /^Straw Hat/ }).filter({ visible: true }).click();
  await page.getByRole("region", { name: "Collections" }).filter({ visible: true }).getByRole("switch", { name: "Summer picks" }).click();
  await expect(page.getByText("Added to Summer picks.")).toBeVisible();
  await page.getByRole("link", { name: "Products" }).filter({ visible: true }).first().click();
  await page.getByRole("link", { name: /^Collections/ }).filter({ visible: true }).click();
  const filled = page.getByRole("group", { name: "Summer picks" }).filter({ visible: true });
  await expect(filled).toContainText("1 product");
  await shot(page, "386-app-collections");

  await web.goto(`${WEB}/admin/collections`);
  await expect(web.getByRole("row", { name: /Summer picks/ })).toContainText("1");

  await filled.getByRole("button", { name: "Delete Summer picks…" }).click();
  await filled.getByRole("button", { name: "Delete Summer picks" }).click();
  await expect(page.getByText("Deleted Summer picks. Its products are still on sale.")).toBeVisible();
  await web.reload();
  await expect(web.getByRole("row", { name: /Summer picks/ })).toHaveCount(0);
});

test("the holiday checklist in the app, with a line set up from the app", async ({ page, browser }) => {
  const { email } = await merchant(browser, `hc${Date.now()}`);
  await signIn(page, email);
  const now = new Date();
  const season = now.getUTCMonth() === 9 || now.getUTCMonth() === 10 || (now.getUTCMonth() === 11 && now.getUTCDate() <= 24);
  if (season) await page.getByRole("button", { name: "Holiday checklist" }).click();
  else await page.goto("/holiday-checklist");
  await expect(page.getByRole("heading", { name: "Holiday checklist", level: 1 })).toBeVisible();
  await expect(page.getByText(/^\d+ of 12 done$/)).toBeVisible();
  const todo = page.getByRole("region", { name: "To do" });
  await expect(todo.getByRole("button", { name: "Schedule a holiday look" })).toBeVisible();
  await shot(page, "387-app-holiday-checklist");

  await todo.getByRole("button", { name: "Email buyers when an order runs late" }).click();
  await expect(page.getByRole("heading", { name: "Running late emails", level: 1 })).toBeVisible();
  await page.getByRole("switch", { name: "Email buyers when an order is running late" }).click();
  await page.getByRole("button", { name: "Save running late emails" }).click();
  await expect(page.getByText(/^Saved\. Buyers hear from you once/)).toBeVisible();

  await page.goto("/holiday-checklist");
  await expect(page.getByRole("region", { name: "Done" }).getByRole("button", { name: "Email buyers when an order runs late, done" })).toBeVisible();
});

test("gift guides made from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `gg${Date.now()}`);
  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Collections/ }).click();
  const guides = page.getByRole("region", { name: "Gift guides" });
  await expect(guides).toContainText("Gifts under $25, Gifts under $50, Gifts under $100");
  await guides.getByRole("button", { name: "Make gift guides" }).click();
  await expect(page.getByText("Made 3 gift guides. They fill themselves with what's in stock at that price, best sellers first.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Gift guides" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Gifts under $50" })).toContainText("Fills by itself");
  await shot(page, "388-app-gift-guides");

  await web.goto(`${WEB}/admin/collections`);
  await expect(web.getByRole("row", { name: /Gifts under \$100/ })).toContainText("By rules");
});

test("gift wrapping turned on from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `gw${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Gift wrapping/ }).click();
  await expect(page.getByRole("heading", { name: "Gift wrapping", level: 1 })).toBeVisible();
  await page.getByRole("switch", { name: "Offer gift wrapping" }).click();
  await page.getByRole("textbox", { name: /^Wrapping price/ }).fill("abc");
  await page.getByRole("button", { name: "Save gift wrapping" }).click();
  await expect(page.getByText("Enter the wrapping price as an amount, like 4.00.")).toBeVisible();
  await page.getByRole("textbox", { name: /^Wrapping price/ }).fill("3.50");
  await page.getByRole("textbox", { name: "What they get (optional)" }).fill("Kraft paper and a ribbon");
  await page.getByRole("button", { name: "Save gift wrapping" }).click();
  await expect(page.getByText("Saved. Buyers sending a gift can have it wrapped.")).toBeVisible();
  await shot(page, "389-app-gift-wrap");

  await page.reload();
  await expect(page.getByRole("textbox", { name: /^Wrapping price/ })).toHaveValue("3.50");
  await expect(page.getByRole("textbox", { name: "What they get (optional)" })).toHaveValue("Kraft paper and a ribbon");
  await web.goto(`${WEB}/admin/shipping`);
  await expect(web.getByLabel(/^Wrapping price/)).toHaveValue("3.50");
  await page.goto("/holiday-checklist");
  await expect(page.getByRole("region", { name: "Done" }).getByRole("button", { name: "Offer gift wrapping, done" })).toBeVisible();

  await page.goto("/gift-wrap");
  await page.getByRole("switch", { name: "Offer gift wrapping" }).click();
  await page.getByRole("button", { name: "Save gift wrapping" }).click();
  await expect(page.getByText("Saved. Checkout doesn't offer gift wrapping.")).toBeVisible();
});

test("checkout reminder emails set from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `cr${Date.now()}`);
  await signIn(page, email);
  await tab(page, "Orders");
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("link", { name: /Left at checkout/ }).click();
  const reminders = page.getByRole("region", { name: "Reminder emails" });
  await expect(reminders.getByRole("switch", { name: "Remind buyers who leave at checkout" })).toBeChecked();
  await reminders.getByRole("switch", { name: "Send a second reminder with a code" }).click();
  await reminders.getByRole("textbox", { name: "Percent off (%)" }).fill("80");
  await reminders.getByRole("button", { name: "Save reminder emails" }).click();
  await expect(page.getByText("Pick between 5% and 50% off.")).toBeVisible();
  await reminders.getByRole("textbox", { name: "Percent off (%)" }).fill("15");
  await reminders.getByRole("button", { name: "Save reminder emails" }).click();
  await expect(page.getByText("Saved. Buyers who leave get a reminder after an hour, and a day later a one-time code for 15% off.")).toBeVisible();
  await shot(page, "390-app-checkout-reminders");

  await web.goto(`${WEB}/admin/marketing`);
  await expect(web.getByLabel("Code gives (% off)")).toHaveValue("15");

  await reminders.getByRole("switch", { name: "Remind buyers who leave at checkout" }).click();
  await reminders.getByRole("button", { name: "Save reminder emails" }).click();
  await expect(page.getByText("Saved. Buyers who leave at checkout aren't reminded.")).toBeVisible();
  await expect(page.getByText("Reminder emails are off, so nobody is reminded. Turn them on below.")).toBeVisible();
});

test("welcome offer and sign-up pop-up set from the app", async ({ page, browser }) => {
  const { email } = await merchant(browser, `su${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("button", { name: "Discount codes" }).click();
  await page.getByRole("link", { name: /^New subscribers/ }).click();
  await expect(page.getByRole("heading", { name: "New subscribers", level: 1 })).toBeVisible();

  const welcome = page.getByRole("region", { name: "Welcome offer" });
  await welcome.getByRole("switch", { name: "Give new subscribers a code" }).click();
  await welcome.getByRole("textbox", { name: "Percent off (%)" }).fill("60");
  await welcome.getByRole("button", { name: "Save welcome offer" }).click();
  await expect(page.getByText("The welcome offer is 5% to 50% off.")).toBeVisible();
  await welcome.getByRole("textbox", { name: "Percent off (%)" }).fill("15");
  await welcome.getByRole("textbox", { name: /^Smallest order/ }).fill("40.00");
  await welcome.getByRole("button", { name: "Save welcome offer" }).click();
  await expect(page.getByText("Saved. New subscribers get 15% off your first order over $40.00, in a code that lasts 30 days.")).toBeVisible();

  const popup = page.getByRole("region", { name: "Sign-up pop-up" });
  await expect(popup).toContainText("offering 15% off your first order over $40.00");
  await popup.getByRole("switch", { name: "Ask new visitors for their email" }).click();
  await popup.getByRole("tab", { name: "15 s" }).click();
  await popup.getByRole("button", { name: "Save pop-up" }).click();
  await expect(page.getByText("Saved. Visitors are asked for their email 15 seconds after they arrive.")).toBeVisible();
  await shot(page, "391-app-signup");

  await page.reload();
  await expect(page.getByRole("tab", { name: "15 s" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: /^Smallest order/ })).toHaveValue("40.00");
  await page.goto("/holiday-checklist");
  await expect(page.getByRole("region", { name: "Done" }).getByRole("button", { name: "Collect emails with a sign-up offer, done" })).toBeVisible();
});

test("holiday returns kept open longer from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `hr${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("button", { name: /^Returns/ }).click();
  await page.getByRole("link", { name: /^Holiday returns/ }).click();
  await expect(page.getByRole("heading", { name: "Holiday returns", level: 1 })).toBeVisible();
  await page.getByRole("switch", { name: "Keep returns open longer for holiday orders" }).click();
  const now = new Date();
  const y = now.getUTCMonth() === 11 && now.getUTCDate() > 24 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  await expect(page.getByRole("textbox", { name: "Orders paid from" })).toHaveValue(`${y}-11-01`);
  await page.getByRole("textbox", { name: "Can be returned until" }).fill(`${y}-12-01`);
  await page.getByRole("button", { name: "Save holiday returns" }).click();
  await expect(page.getByText("Returns have to stay open after the last order day.")).toBeVisible();
  await page.getByRole("textbox", { name: "Can be returned until" }).fill(`${y + 1}-01-31`);
  await page.getByRole("button", { name: "Save holiday returns" }).click();
  await expect(page.getByText("Saved. Orders paid Nov 1 to Dec 24 can be returned until Jan 31.")).toBeVisible();
  await shot(page, "392-app-holiday-returns");

  await web.goto(`${WEB}/admin/returns`);
  await expect(web.getByLabel("Returns open until")).toHaveValue(`${y + 1}-01-31`);
  await page.goto("/holiday-checklist");
  await expect(page.getByRole("region", { name: "Done" }).getByRole("button", { name: "Keep returns open for gifts, done" })).toBeVisible();
});

test("gift cards put on sale from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sg${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("button", { name: "Gift cards" }).click();
  const sell = page.getByRole("region", { name: "Sell gift cards" });
  await sell.getByRole("textbox", { name: "Amounts" }).fill("20, abc");
  await sell.getByRole("button", { name: "Start selling gift cards" }).click();
  await expect(page.getByText("Enter amounts like 25 or 49.99.")).toBeVisible();
  await sell.getByRole("textbox", { name: "Amounts" }).fill("40, 20");
  await sell.getByRole("button", { name: "Start selling gift cards" }).click();
  await expect(page.getByText("Gift cards are on sale. Buyers get the code by email right after paying.")).toBeVisible();
  await expect(sell.getByRole("link", { name: /On sale on your store/ })).toContainText("$20.00, $40.00");
  await shot(page, "393-app-sell-gift-cards");

  await web.goto(`${WEB}/admin/gift-cards`);
  await expect(web.getByRole("link", { name: "Gift card product" })).toBeVisible();
  await page.goto("/holiday-checklist");
  await expect(page.getByRole("region", { name: "Done" }).getByRole("button", { name: "Sell gift cards, done" })).toBeVisible();
});

test("delivery dates set from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `dd${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Delivery dates/ }).click();
  await expect(page.getByRole("heading", { name: "Delivery dates", level: 1 })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Show delivery dates" })).toBeChecked();
  await page.getByRole("textbox", { name: "Days to get an order ready" }).fill("20");
  await page.getByRole("button", { name: "Save delivery dates" }).click();
  await expect(page.getByText("Processing time is between 0 and 14 days.")).toBeVisible();
  await page.getByRole("textbox", { name: "Days to get an order ready" }).fill("3");
  await page.getByRole("button", { name: "Save delivery dates" }).click();
  await expect(page.getByText("Saved. Product pages, the cart and receipts say when orders arrive.")).toBeVisible();
  await shot(page, "394-app-delivery-dates");
  await web.goto(`${WEB}/admin/shipping`);
  await expect(web.getByLabel("Processing days")).toHaveValue("3");

  await page.getByRole("switch", { name: "Show delivery dates" }).click();
  await page.getByRole("button", { name: "Save delivery dates" }).click();
  await expect(page.getByText("Saved. Buyers don't see delivery dates.")).toBeVisible();
  await page.goto("/holiday-checklist");
  await expect(page.getByRole("region", { name: "To do" }).getByRole("button", { name: "Show delivery dates" })).toBeVisible();
});

test("a backup supplier added and removed from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `bs${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /galaxy projector low stock/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Galaxy Projector/i }).first().click();
  const backup = page.getByRole("region", { name: "Backup supplier" });
  await backup.getByRole("textbox", { name: "Backup supplier link" }).fill("https://demo-supplier.test/p/sunset-projection-lamp-2");
  await backup.getByRole("button", { name: "Add backup" }).click();
  await expect(page.getByText(/^None of that listing's options \(Default\) match/)).toBeVisible();
  await backup.getByRole("textbox", { name: "Backup supplier link" }).fill("https://demo-supplier.test/p/galaxy-projector");
  await backup.getByRole("button", { name: "Add backup" }).click();
  await expect(page.getByText("Backup saved. Orders go there when the main supplier is out of stock.")).toBeVisible();
  await expect(backup.getByRole("list", { name: "Backup options" })).toContainText(/Small: costs \$[\d.]+/);
  await shot(page, "395-app-backup-supplier");

  await web.reload();
  await expect(web.getByRole("region", { name: "Backup supplier" }).getByRole("list", { name: "Backup options" })).toContainText("Small");

  await backup.getByRole("button", { name: "Remove backup…" }).click();
  await backup.getByRole("button", { name: "Remove backup" }).click();
  await expect(page.getByText("Backup removed.")).toBeVisible();
  await expect(backup.getByRole("textbox", { name: "Backup supplier link" })).toBeVisible();
});

test("a new store look scheduled, cancelled and published from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `lk${Date.now()}`);
  await web.goto(`${WEB}/admin/theme`);
  await web.getByRole("tab", { name: "Themes" }).click();
  await web.getByLabel("Also replace my home page sections").check();
  await web.getByRole("button", { name: "Use Boutique" }).click();
  await expect(web.getByText("Draft saved. Not live yet.")).toBeVisible();

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Store look/ }).click();
  const draft = page.getByRole("region", { name: "Your draft" });
  await expect(draft).toContainText("Your draft has changes that aren't on the store yet.");
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await draft.getByRole("textbox", { name: "Goes live on" }).fill(day(10));
  await draft.getByRole("textbox", { name: "Switches back on (optional)" }).fill(day(5));
  await draft.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText("Switch back after the new look goes live.")).toBeVisible();
  await draft.getByRole("textbox", { name: "Switches back on (optional)" }).fill(day(12));
  await draft.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText("Scheduled. The new look goes live by itself and switches back when you said.")).toBeVisible();
  const scheduled = page.getByRole("region", { name: "Scheduled" });
  await expect(scheduled.getByText(/^Goes live /)).toBeVisible();
  await expect(scheduled.getByText(/^Switches back /)).toBeVisible();
  await shot(page, "396-app-store-look");
  await page.goto("/holiday-checklist");
  await expect(page.getByRole("region", { name: "Done" }).getByRole("button", { name: "Schedule a holiday look, done" })).toBeVisible();

  await page.goto("/store-look");
  await page.getByRole("button", { name: "Cancel the scheduled look…" }).click();
  await page.getByRole("button", { name: "Cancel the scheduled look" }).click();
  await expect(page.getByText("Cancelled. The store keeps the look it has.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Scheduled" })).toHaveCount(0);
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText("Published. Buyers see the new look now.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your draft" })).toContainText("The store shows your latest look.");
});

test("a search that found nothing fixed from the app", async ({ page, browser }) => {
  const id = `sf${Date.now()}`;
  const { web, email } = await merchant(browser, id);
  const buyer = await (await browser.newContext()).newPage();
  for (const q of ["lampshade", "lampshade", "glow thing"]) {
    await buyer.goto(`${WEB}/s/pocket-shop-${id}/search?q=${encodeURIComponent(q)}`);
    await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
  }

  await signIn(page, email);
  await page.goto("/products");
  await page.getByRole("link", { name: /^Search fixes/ }).click();
  const nothing = page.getByRole("region", { name: "Found nothing" });
  await expect(async () => {
    await page.reload();
    await expect(nothing.getByRole("button", { name: "Fix “lampshade”, 2 searches" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(nothing.getByRole("button", { name: "Fix “glow thing”, 1 search" })).toBeVisible();
  await nothing.getByRole("button", { name: "Fix “lampshade”, 2 searches" }).click();
  await expect(page.getByRole("textbox", { name: "When shoppers search for" })).toHaveValue("lampshade");
  await page.getByRole("textbox", { name: "Show the results for" }).fill("lampshade");
  await page.getByRole("button", { name: "Save fix" }).click();
  await expect(page.getByText("Pick different words to show results for.")).toBeVisible();
  await page.getByRole("textbox", { name: "Show the results for" }).fill("Lamp Shade");
  await page.getByRole("button", { name: "Save fix" }).click();
  await expect(page.getByText("Saved. Searching “lampshade” now shows the results for “lamp shade”.")).toBeVisible();
  const fixes = page.getByRole("region", { name: "Your search fixes" });
  await expect(fixes).toContainText("“lampshade” shows the results for “lamp shade”");
  // A fixed search leaves the list of ones that found nothing.
  await expect(nothing.getByRole("button", { name: /^Fix “lampshade”/ })).toHaveCount(0);
  await shot(page, "397-app-search-fixes");

  await web.goto(`${WEB}/admin/search-fixes`);
  await expect(web.getByRole("region", { name: "Your search fixes" })).toContainText("lampshade shows results for lamp shade");

  await fixes.getByRole("button", { name: "Remove the fix for “lampshade”" }).click();
  await expect(page.getByText("Removed. Searching “lampshade” shows its own results again.")).toBeVisible();
  await expect(fixes).toContainText("No fixes yet");
  await expect(nothing.getByRole("button", { name: "Fix “lampshade”, 2 searches" })).toBeVisible();
});

test("a blog post written, published, scheduled and deleted from the app", async ({ page, browser }) => {
  const id = `bl${Date.now()}`;
  const { email } = await merchant(browser, id);
  const buyer = await (await browser.newContext()).newPage();
  const title = "Five ways to light a small room";

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Blog posts/ }).click();
  await expect(page.getByText("No posts yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("button", { name: "Start a post" }).click();
  await expect(page).toHaveURL(/\/blog\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();

  const post = page.getByRole("textbox", { name: "Post" });
  await post.fill("Too short.");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText("Write a bit more before publishing: the post is nearly empty.")).toBeVisible();
  await post.fill("A small room needs light from more than one place.\n\n## Start with a lamp\n\nA warm lamp in a corner makes the room feel bigger.\n- Pick warm bulbs\n- Keep the ceiling light off");
  await page.getByRole("textbox", { name: "Topics (optional)" }).fill("Lighting, Small spaces");
  // Publishing saves the writing first.
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText("Published. The post is on your store's blog.")).toBeVisible();
  await expect(page.getByText(/^Live since /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Share the post" })).toBeVisible();
  await shot(page, "398-app-blog");

  await buyer.goto(`${WEB}/s/pocket-shop-${id}/blog`);
  await buyer.getByRole("link", { name: title }).click();
  await expect(buyer.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(buyer.getByRole("heading", { name: "Start with a lamp" })).toBeVisible();
  await expect(buyer.getByRole("listitem").filter({ hasText: "Pick warm bulbs" })).toBeVisible();

  await page.getByRole("button", { name: "Unpublish" }).click();
  await expect(page.getByText("Unpublished. The post is a draft again and off your store.")).toBeVisible();
  await buyer.goto(`${WEB}/s/pocket-shop-${id}/blog`);
  await expect(buyer.getByText("Nothing here yet.")).toBeVisible();

  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await page.getByRole("textbox", { name: "Publish on" }).fill(day);
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText("Scheduled. The post goes up on your store by itself.")).toBeVisible();
  await expect(page.getByText(/^Goes up /)).toBeVisible();
  await page.goto("/blog");
  await expect(page.getByRole("link", { name: new RegExp(`^${title}, Goes up `) })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(`^${title}`) }).click();
  await page.getByRole("button", { name: "Delete this post…" }).click();
  await page.getByRole("button", { name: "Delete this post" }).click();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(page.getByText("No posts yet")).toBeVisible();
});

test("a warning from us read and answered in the app", async ({ page, browser }) => {
  const id = `tr${Date.now()}`;
  const { email } = await merchant(browser, id);
  // Staff (listed in STAFF_EMAILS for the test server) warn the store.
  const staff = await (await browser.newContext()).newPage();
  await staff.goto(`${WEB}/signup`);
  await staff.getByLabel("Email").fill("staff-app@example.com");
  await staff.getByLabel("Password").fill(PASSWORD);
  await staff.getByRole("button", { name: "Create account" }).click();
  await expect(staff.getByLabel("Store name")).toBeVisible();
  await staff.goto(`${WEB}/staff`);
  await staff.getByRole("link", { name: `Pocket Shop ${id}` }).click();
  await staff.getByLabel("Reason").selectOption("late_shipping");
  await staff.getByLabel(/What happened/).fill("Four orders from last week still have no tracking after 10 days.");
  await staff.getByRole("button", { name: "Send notice" }).click();
  await expect(staff.getByText("Sent.")).toBeVisible();

  await signIn(page, email);
  await page.getByRole("link", { name: /^A warning from us/ }).click();
  await expect(page).toHaveURL(/\/notices$/);
  await expect(page.getByText("Your store is open, but there's something to fix below.")).toBeVisible();
  const notice = page.getByRole("region", { name: "Orders are shipping late" });
  await expect(notice).toContainText("Warning");
  await expect(notice).toContainText(/Fix by /);
  await expect(notice).toContainText("What happened: Four orders from last week still have no tracking after 10 days.");
  await expect(notice).toContainText("What to do: Ship or refund the late orders");

  const reply = notice.getByRole("textbox", { name: "What you changed, or why this is wrong" });
  await reply.fill("Shipped.");
  await notice.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Tell us what you changed or why you think this is wrong, in a sentence or two.")).toBeVisible();
  await reply.fill("All four orders shipped yesterday with tracking, and I moved those items to a faster supplier.");
  await notice.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Sent. A person reads every appeal and replies here, usually within two working days.")).toBeVisible();
  await expect(notice).toContainText("Your appeal: All four orders shipped yesterday");
  await expect(notice).toContainText("Waiting for a reply.");
  await expect(notice.getByRole("button", { name: "Send reply" })).toHaveCount(0);

  const badge = page.getByRole("region", { name: "Verified store badge" });
  await expect(badge.getByRole("listitem", { name: "In good standing, with no open warnings: not yet, 1 open" })).toBeVisible();
  await badge.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText("Checked. Your store doesn't meet every rule yet.")).toBeVisible();
  await shot(page, "399-app-trust");

  // A person accepts the appeal, which closes the warning.
  await staff.goto(`${WEB}/staff`);
  const appeal = staff.getByRole("article").filter({ hasText: `Pocket Shop ${id}` });
  await appeal.getByLabel("Reply to the merchant").fill("Thanks, confirmed the tracking. Closed.");
  await appeal.getByRole("button", { name: "Accept" }).click();
  await expect(appeal).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("All good. Nothing needs your attention.")).toBeVisible();
  await expect(page.getByRole("region", { name: "History" })).toContainText("Orders are shipping late");
  await expect(badge.getByRole("listitem", { name: "In good standing, with no open warnings: met, Good standing" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("link", { name: /^Your store's standing/ })).toBeVisible();
});

test("store pages and policies added and edited from the app", async ({ page, browser }) => {
  const id = `pg${Date.now()}`;
  const { email } = await merchant(browser, id);
  const buyer = await (await browser.newContext()).newPage();

  await signIn(page, email);
  await page.goto("/notices");
  const badge = page.getByRole("region", { name: "Verified store badge" });
  await expect(badge.getByRole("listitem", { name: /^A returns policy buyers can read: not yet/ })).toBeVisible();
  await badge.getByRole("link", { name: "Add a returns page" }).click();
  await expect(page).toHaveURL(/\/pages$/);
  await expect(page.getByText("No pages yet")).toBeVisible();

  const policies = page.getByRole("region", { name: "Store policies" });
  await policies.getByRole("switch", { name: "Privacy policy" }).click();
  await policies.getByRole("switch", { name: "Terms of service" }).click();
  await policies.getByRole("button", { name: "Add policy pages" }).click();
  await expect(page.getByText("Added Returns and refunds, Shipping, Accessibility statement. Edit them any time.")).toBeVisible();
  const mine = page.getByRole("region", { name: "Your pages" });
  await expect(mine.getByRole("link", { name: "Returns and refunds, visible" })).toBeVisible();
  await expect(policies.getByRole("switch", { name: "Privacy policy" })).toBeVisible();
  await expect(policies.getByRole("switch", { name: "Returns and refunds" })).toHaveCount(0);
  await buyer.goto(`${WEB}/s/pocket-shop-${id}/pages/returns`);
  await expect(buyer.getByRole("heading", { name: "Returns and refunds" })).toBeVisible();

  // A page of your own starts hidden.
  await page.getByRole("textbox", { name: "Title" }).fill("About us");
  await page.getByRole("button", { name: "Start a page" }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/);
  await page.getByRole("textbox", { name: "Text" }).fill("We're two friends who make lamps in Austin.\n\nEvery lamp is tested before it ships.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. The page is hidden from buyers.")).toBeVisible();
  await buyer.goto(`${WEB}/s/pocket-shop-${id}/pages/about-us`);
  await expect(buyer.getByRole("heading", { name: "About us" })).toHaveCount(0);
  await page.getByRole("switch", { name: "Visible on the store" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. The page is on your store.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Share the page" })).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("heading", { name: "About us" })).toBeVisible();
  await expect(buyer.getByText("Every lamp is tested before it ships.")).toBeVisible();
  await shot(page, "400-app-pages");

  await page.getByRole("button", { name: "Delete this page…" }).click();
  await page.getByRole("button", { name: "Delete this page" }).click();
  await expect(page).toHaveURL(/\/pages$/);
  await expect(mine.getByRole("link", { name: /^About us/ })).toHaveCount(0);

  await page.goto("/notices");
  await expect(badge.getByRole("listitem", { name: /^A returns policy buyers can read: met/ })).toBeVisible();
});

test("what shoppers search for, on the app's Analytics screen", async ({ page, browser }) => {
  const id = `sr${Date.now()}`;
  const { email } = await merchant(browser, id);
  const buyer = await (await browser.newContext()).newPage();
  for (const q of ["night light", "night light", "lampshade"]) {
    await buyer.goto(`${WEB}/s/pocket-shop-${id}/search?q=${encodeURIComponent(q)}`);
    await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
  }

  await signIn(page, email);
  await page.goto("/analytics");
  const searches = page.getByRole("region", { name: "What shoppers search for" });
  await expect(async () => {
    await page.reload();
    await expect(searches.getByText("3 searches, 100% found nothing.")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(searches.getByText("2 searches", { exact: true })).toBeVisible();
  await shot(page, "401-app-search-report");
  await searches.getByRole("link", { name: "Fix the search “lampshade”" }).click();
  await expect(page).toHaveURL(/\/search-fixes\?from=lampshade$/);
  await expect(page.getByRole("textbox", { name: "When shoppers search for" })).toHaveValue("lampshade");
});

test("buyers who come back, on the app's Analytics screen", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `rb${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  // The same buyer orders twice.
  await buy(browser, lamp);
  await buy(browser, lamp);

  await signIn(page, email);
  await page.goto("/analytics");
  const back = page.getByRole("region", { name: "Buyers who come back" });
  await expect(back).toContainText("Once a month's first-time buyers have had 90 days, this says how many ordered again.");
  const month = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  await expect(back).toContainText(month);
  await expect(back).toContainText("1 new buyer");
  await expect(back).toContainText("1 came back · 100% so far");
  await shot(page, "402-app-repeat-buyers");
});

test("the store's own stock on the app's Inventory screen", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `iv${Date.now()}`);
  let olive = "";
  for (const [title, stock] of [["Olive Soap", "3"], ["Lavender Soap", "6"]]) {
    await web.goto(`${WEB}/admin/products/new`);
    await web.getByLabel("Title").fill(title!);
    await web.getByLabel("Price", { exact: true }).fill("7.00");
    await web.getByLabel("Stock", { exact: true }).fill(stock!);
    await web.getByRole("button", { name: "Save product" }).click();
    await expect(web.getByText("Product added.")).toBeVisible();
    if (!olive) olive = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;
  }
  await buy(browser, olive);

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Inventory/ }).click();
  await expect(page.getByText("In stock", { exact: true })).toBeVisible();
  await expect(page.getByText("2 options have no cost, so the worth at cost leaves them out.", { exact: false })).toBeVisible();
  const list = page.getByRole("region", { name: "Soonest to run out" });
  // The one that sold comes first, with how long it lasts at that pace, marked when it runs low.
  await expect(list.getByRole("link").first()).toHaveAccessibleName("Olive Soap, running low: 2 in stock · 1 sold in 30 days · lasts about 60 days");
  await expect(list.getByRole("link", { name: "Lavender Soap: 6 in stock · 0 sold in 30 days" })).toBeVisible();
  await shot(page, "403-app-inventory");
  await list.getByRole("link", { name: /^Olive Soap/ }).click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/);
});

test("the plan, what it cost and switching, from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pl${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();
  await buy(browser, new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href);

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Your plan/ }).click();
  const free = page.getByRole("region", { name: "You're on Free" });
  await expect(free).toContainText(/Last 30 days: 1 order, \$[\d.,]+ in sales\. This plan cost you \$[\d.,]+ \(\$[\d.,]+ in sales fees\)\./);
  await expect(page.getByRole("group", { name: "Free" })).toContainText("Current");
  await expect(page.getByText("Test mode: plan changes apply straight away and nothing is charged.")).toBeVisible();

  await page.getByRole("button", { name: "Upgrade to Starter…" }).click();
  await page.getByRole("button", { name: "Upgrade to Starter now" }).click();
  await expect(page.getByText("Done. You're on Starter.")).toBeVisible();
  const starter = page.getByRole("region", { name: "You're on Starter" });
  // For one small order, the free plan would have cost less: the app says so.
  await expect(starter).toContainText(/Free would have cost \$[\d.,]+ less for the same sales\./);
  await expect(page.getByRole("group", { name: "Free" })).toContainText("Costs least");
  await expect(page.getByRole("button", { name: "Switch to Free…" })).toBeVisible();
  await shot(page, "404-app-plan");

  await web.goto(`${WEB}/admin/plan`);
  await expect(web.getByRole("heading", { name: "You're on Starter" })).toBeVisible();
});

test("the pricing rule changed from the app, and products brought in line", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pr${Date.now()}`);
  await web.goto(`${WEB}/admin/products/import`);
  await web.getByRole("link", { name: /sunset projection lamp/i }).click();
  await web.getByRole("button", { name: "Import and publish" }).click();
  await expect(web.getByText("Imported and live on your store.")).toBeVisible();

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Pricing rule/ }).click();
  const examples = page.getByRole("region", { name: "Examples" });
  await expect(examples).toContainText(/Costs \$3\.00: sells for \$[\d.]+\.99/);
  const off = page.getByRole("region", { name: "Products that don't follow the rule" });
  await expect(off).toContainText("Every product with a known supplier cost already follows your rule.");

  const times = page.getByRole("textbox", { name: "Times the supplier's cost" });
  await times.fill("lots");
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("Enter how many times the cost, like 2.5.")).toBeVisible();
  await times.fill("4");
  await page.getByRole("tab", { name: ".00" }).click();
  await page.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("Saved. Products you import from now on start at these prices.")).toBeVisible();
  await expect(examples).toContainText("Costs $3.00: sells for $12.00");
  await expect(off).toContainText("1 product has prices your rule would change.");
  await expect(off.getByRole("link", { name: /^Sunset Projection Lamp/ }).first()).toBeVisible();
  await shot(page, "405-app-pricing");

  await off.getByRole("button", { name: "Update 1 product…" }).click();
  await off.getByRole("button", { name: "Update 1 product now" }).click();
  await expect(page.getByText(/^Updated \d+ prices? on 1 product\.$/)).toBeVisible();
  await expect(off).toContainText("Every product with a known supplier cost already follows your rule.");
  await web.goto(`${WEB}/admin/pricing`);
  await expect(web.getByText("Every product with a known supplier cost already follows your rule.")).toBeVisible();
});

test("checkout settings from the app: smallest order, phone number and delivery protection", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `co${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Checkout/ }).click();

  const min = page.getByRole("region", { name: "Smallest order" });
  await min.getByRole("textbox", { name: "Smallest order (USD)" }).fill("fifteen");
  await min.getByRole("button", { name: "Save smallest order" }).click();
  await expect(page.getByText("Enter the smallest order as an amount, like 15.00.")).toBeVisible();
  await min.getByRole("textbox", { name: "Smallest order (USD)" }).fill("$15");
  await min.getByRole("button", { name: "Save smallest order" }).click();
  await expect(page.getByText("Saved. Carts under $15.00 ask for a little more before checkout.")).toBeVisible();

  const phone = page.getByRole("region", { name: "Phone number at checkout" });
  await phone.getByRole("tab", { name: "Required" }).click();
  await phone.getByRole("button", { name: "Save phone number" }).click();
  await expect(page.getByText("Saved. Checkout needs a phone number.")).toBeVisible();

  const protection = page.getByRole("region", { name: "Delivery protection" });
  await protection.getByRole("switch", { name: "Offer delivery protection" }).click();
  await protection.getByRole("textbox", { name: "Price, % of the order" }).fill("50");
  await protection.getByRole("button", { name: "Save delivery protection" }).click();
  await expect(page.getByText(/^Pick between 0\.5% and \d+% of the order\.$/)).toBeVisible();
  await protection.getByRole("textbox", { name: "Price, % of the order" }).fill("3");
  await protection.getByRole("button", { name: "Save delivery protection" }).click();
  await expect(page.getByText("Saved. Buyers can protect their parcel at checkout.")).toBeVisible();
  await shot(page, "406-app-checkout-settings");

  await web.goto(`${WEB}/admin/shipping`);
  await expect(web.getByLabel("Smallest order ($)")).toHaveValue("15.00");
  await expect(web.getByLabel("Buyers must enter one")).toBeChecked();
});

test("local pickup and local delivery turned on from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `lo${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Pickup and local delivery/ }).click();

  const pickup = page.getByRole("region", { name: "Local pickup" });
  await pickup.getByRole("switch", { name: "Offer local pickup" }).click();
  await pickup.getByRole("button", { name: "Save pickup" }).click();
  await expect(page.getByText("Enter the address buyers pick up from.")).toBeVisible();
  await pickup.getByRole("textbox", { name: "Pickup address" }).fill("12 Main St, Austin, TX 78701");
  await pickup.getByRole("textbox", { name: "How to collect (optional)" }).fill("Ring the bell at the side door.");
  await pickup.getByRole("button", { name: "Save pickup" }).click();
  await expect(page.getByText("Saved. Buyers can pick up their order at checkout.")).toBeVisible();

  const delivery = page.getByRole("region", { name: "Local delivery" });
  await delivery.getByRole("switch", { name: "Offer local delivery" }).click();
  await delivery.getByRole("textbox", { name: "Postal codes you deliver to" }).fill("787, 78613");
  await delivery.getByRole("textbox", { name: "Delivery price (USD)" }).fill("five");
  await delivery.getByRole("button", { name: "Save local delivery" }).click();
  await expect(page.getByText("Enter the delivery price as an amount, like 5.00.")).toBeVisible();
  await delivery.getByRole("textbox", { name: "Delivery price (USD)" }).fill("5");
  await delivery.getByRole("textbox", { name: "Free on orders over (USD, optional)" }).fill("50");
  await delivery.getByRole("button", { name: "Save local delivery" }).click();
  await expect(page.getByText("Saved. Buyers in 2 postal codes can have it delivered by you.")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Pickups and deliveries/ })).toBeVisible();
  await shot(page, "407-app-local");

  await web.goto(`${WEB}/admin/shipping`);
  await expect(web.getByLabel("Pickup address")).toHaveValue("12 Main St, Austin, TX 78701");
  await expect(web.getByLabel("Postal codes you deliver to")).toHaveValue("78613, 787");
  await expect(web.getByLabel(/^Delivery price/)).toHaveValue("5.00");
});

test("pickup and delivery days picked from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `hd${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Pickup and local delivery/ }).click();
  // The days only matter once the store hands orders over itself.
  await expect(page.getByRole("region", { name: "Pickup and delivery days" })).toHaveCount(0);
  const pickup = page.getByRole("region", { name: "Local pickup" });
  await pickup.getByRole("switch", { name: "Offer local pickup" }).click();
  await pickup.getByRole("textbox", { name: "Pickup address" }).fill("12 Main St, Austin, TX 78701");
  await pickup.getByRole("button", { name: "Save pickup" }).click();
  await expect(page.getByText("Saved. Buyers can pick up their order at checkout.")).toBeVisible();

  const days = page.getByRole("region", { name: "Pickup and delivery days" });
  await days.getByRole("switch", { name: "Buyers pick the day they collect or get their order" }).click();
  for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]) await days.getByRole("switch", { name: d, exact: true }).click();
  await days.getByRole("button", { name: "Save days" }).click();
  await expect(page.getByText("Tick at least one day.")).toBeVisible();
  await days.getByRole("switch", { name: "Saturday", exact: true }).click();
  await days.getByRole("textbox", { name: "Days' notice you need" }).fill("9");
  await days.getByRole("button", { name: "Save days" }).click();
  await expect(page.getByText("Pick 0 to 7 days' notice.")).toBeVisible();
  await days.getByRole("textbox", { name: "Days' notice you need" }).fill("2");
  await days.getByRole("switch", { name: "Sunday", exact: true }).click();
  await days.getByRole("button", { name: "Save days" }).click();
  await expect(page.getByText("Saved. Buyers pick from Saturday, Sunday at checkout.")).toBeVisible();
  await shot(page, "408-app-handover-days");

  await web.goto(`${WEB}/admin/shipping`);
  await expect(web.getByRole("checkbox", { name: "Buyers pick the day they collect or get their order" })).toBeChecked();
  await expect(web.getByRole("checkbox", { name: "Saturday" })).toBeChecked();
  await expect(web.getByRole("checkbox", { name: "Monday" })).not.toBeChecked();
  await expect(web.getByLabel("Notice you need")).toHaveValue("2");
});

test("the profit report and ad spend for a product, from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `pr${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByLabel("Stock", { exact: true }).fill("6");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  await buy(browser, new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href);

  await signIn(page, email);
  await tab(page, "Money");
  await page.getByRole("link", { name: /^Profit report/ }).click();
  await expect(page.getByRole("heading", { name: "Profit", level: 1 })).toBeVisible();
  // Not posted yet, so no cost counts against it.
  await expect(page.getByRole("link", { name: /^Beeswax Candle, profit \$\d/ })).toBeVisible();

  const ads = page.getByRole("region", { name: "Ad spend" });
  await ads.getByRole("tab", { name: "TikTok" }).click();
  await ads.getByRole("textbox", { name: "Amount spent (USD)" }).fill("eight");
  await ads.getByRole("button", { name: "Add ad spend" }).click();
  await expect(page.getByText("Enter how much you spent, like 25.00.")).toBeVisible();
  await ads.getByRole("textbox", { name: "Amount spent (USD)" }).fill("8");
  await ads.getByRole("textbox", { name: "For a product (optional)" }).fill("bees");
  await ads.getByRole("button", { name: "Spend on Beeswax Candle" }).click();
  await expect(ads.getByRole("button", { name: /^For Beeswax Candle/ })).toBeVisible();
  await ads.getByRole("textbox", { name: "Note (optional)" }).fill("Launch post");
  await ads.getByRole("button", { name: "Add ad spend" }).click();
  await expect(page.getByText("Ad spend added.")).toBeVisible();
  const today = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date());
  await expect(ads.getByRole("button", { name: `Remove $8.00 on ${today}` })).toBeVisible();
  await expect(ads.getByText("TikTok · Beeswax Candle · Launch post")).toBeVisible();
  // Twelve dollars of sales for eight of ads.
  await expect(page.getByText(/ROAS 1\.5×/)).toBeVisible();
  await page.getByRole("tab", { name: "7 days" }).click();
  await expect(ads.getByRole("button", { name: `Remove $8.00 on ${today}` })).toBeVisible();
  await shot(page, "409-app-profit");

  await web.goto(`${WEB}/admin/profit`);
  await expect(web.getByRole("table", { name: "Ad spend entered" })).toContainText("Beeswax Candle");
  await expect(web.getByRole("table", { name: "Ad spend entered" })).toContainText("$8.00");

  await ads.getByRole("button", { name: `Remove $8.00 on ${today}` }).click();
  await expect(page.getByText("Ad spend removed.")).toBeVisible();
  await expect(ads.getByRole("button", { name: /^Remove / })).toHaveCount(0);
});

test("a size chart typed one size per line in the app shows on the product page", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sz${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Linen Shirt");
  await web.getByLabel("Price", { exact: true }).fill("30.00");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const shirt = new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href;

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Size charts/ }).click();
  await expect(page.getByText("No size charts yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Name" }).fill("Shirts");
  await page.getByRole("button", { name: "Start size chart" }).click();
  await expect(page.getByRole("heading", { name: "Shirts", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Columns" })).toHaveValue("Size, Chest, Waist, Length");

  const sizes = page.getByRole("textbox", { name: "Sizes" });
  await sizes.fill("S, 86-91, 71-76, 70\nm, 96-101\nM, 1, 2, 3");
  await page.getByRole("button", { name: "Save size chart" }).click();
  await expect(page.getByText("Each size can only be in the chart once.")).toBeVisible();
  // A short line gets empty cells at the end, to fill in later.
  await sizes.fill("S, 86-91, 71-76, 70\nM, 96-101\nXL, 112, 97, 76");
  await page.getByRole("textbox", { name: "Add a product" }).fill("linen");
  await page.getByRole("button", { name: "Add Linen Shirt" }).click();
  await expect(page.getByRole("button", { name: "Take Linen Shirt off this chart" })).toBeVisible();
  await page.getByRole("button", { name: "Save size chart" }).click();
  await expect(page.getByText("Saved. It shows on the products it's attached to.")).toBeVisible();
  await expect(sizes).toHaveValue("S, 86-91, 71-76, 70\nM, 96-101, , \nXL, 112, 97, 76");
  await shot(page, "410-app-size-chart");

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(shirt);
  await buyer.getByRole("button", { name: "Size chart" }).click();
  const dialog = buyer.getByRole("dialog", { name: "Size chart: Shirts" });
  await expect(dialog.getByRole("row", { name: /XL/ })).toContainText("112");
  await expect(dialog.getByRole("columnheader", { name: "Chest (cm)" })).toBeVisible();

  await page.getByRole("link", { name: "← Size charts" }).click();
  await expect(page.getByRole("link", { name: "Shirts, on the store" })).toBeVisible();
  await expect(page.getByText("3 sizes · 1 product")).toBeVisible();
  await page.getByRole("link", { name: "Shirts, on the store" }).click();
  await page.getByRole("button", { name: "Delete this size chart…" }).click();
  await page.getByRole("button", { name: "Delete this size chart" }).click();
  // The list screen from before is still in the stack; the one on top is new.
  await expect(page.getByText("No size charts yet").last()).toBeVisible();
});

test("redirects added from the app send old links to the right page", async ({ page, browser }) => {
  const id = `rd${Date.now()}`;
  const { email } = await merchant(browser, id);
  const store = `${WEB}/s/pocket-shop-${id}`;
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Redirects/ }).click();
  await expect(page.getByText("No redirects yet")).toBeVisible();

  const box = page.getByRole("textbox", { name: "One per line: the old address, then where it goes" });
  await box.fill("/pages/about-us /pages/contact\n/pages/faq /pages/faq\njust-one");
  await page.getByRole("button", { name: "Add redirects" }).click();
  await expect(page.getByText("Added 1 redirect.")).toBeVisible();
  await expect(page.getByText(/A redirect can't point to itself\./)).toBeVisible();
  await expect(page.getByText(/Needs two addresses: old, then new\./)).toBeVisible();
  // What didn't work stays in the box to fix.
  await expect(box).toHaveValue("/pages/faq /pages/faq\njust-one");
  await expect(page.getByText("Goes to /pages/contact · 0 visits")).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(`${store}/pages/about-us`);
  await expect(buyer).toHaveURL(new RegExp(`${store}/pages/contact$`));
  await page.getByRole("link", { name: "← Settings" }).click();
  await page.getByRole("link", { name: /^Redirects/ }).click();
  await expect(page.getByText("Goes to /pages/contact · 1 visit").last()).toBeVisible();
  await shot(page, "411-app-redirects");

  await page.getByRole("textbox", { name: "Search redirects" }).fill("nothing-like-it");
  await expect(page.getByText("No redirects match")).toBeVisible();
  await page.getByRole("textbox", { name: "Search redirects" }).fill("about");
  await page.getByRole("button", { name: "Remove redirect from /pages/about-us" }).click();
  await expect(page.getByText("Redirect removed.")).toBeVisible();
  await expect(page.getByText("No redirects yet")).toBeVisible();
});

test("currencies buyers can pay in, turned on from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `cu${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Currencies/ }).click();
  await expect(page.getByText("USD is always on: it's your store's currency.")).toBeVisible();
  // Each rate shows what a product would cost in that currency, rounded to .99 until that's turned off.
  await expect(page.getByText(/^1 USD is \d\.\d{4} · A product at \$24\.99 is €\d+\.99$/)).toBeVisible();
  await page.getByRole("switch", { name: "EUR · Euro" }).click();
  await page.getByRole("switch", { name: "GBP · British pound" }).click();
  await page.getByRole("switch", { name: "Round converted prices to end in .99" }).click();
  await page.getByRole("button", { name: "Save currencies" }).click();
  await expect(page.getByText("Saved. Buyers see the change on their next page.")).toBeVisible();
  await shot(page, "412-app-currencies");

  await web.goto(`${WEB}/admin/currencies`);
  await expect(web.getByRole("checkbox", { name: "EUR · Euro" })).toBeChecked();
  await expect(web.getByRole("checkbox", { name: "GBP · British pound" })).toBeChecked();
  await expect(web.getByRole("checkbox", { name: "CAD · Canadian dollar" })).not.toBeChecked();
  await expect(web.getByRole("checkbox", { name: /Round converted prices/ })).not.toBeChecked();
});

test("store languages turned on from the app, with how much is translated", async ({ page, browser }) => {
  const id = `la${Date.now()}`;
  const { web, email } = await merchant(browser, id);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Store languages/ }).click();
  await expect(page.getByText("English is always on: it's your store's language.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Translated so far" })).toHaveCount(0);
  await page.getByRole("switch", { name: "German · Deutsch" }).click();
  await page.getByRole("switch", { name: "French · Français" }).click();
  await page.getByRole("button", { name: "Save languages" }).click();
  await expect(page.getByText("Saved. Buyers can pick these languages at the bottom of the store.")).toBeVisible();
  const done = page.getByRole("region", { name: "Translated so far" });
  await expect(done.getByText("German", { exact: true })).toBeVisible();
  await expect(done.getByText("French", { exact: true })).toBeVisible();
  await expect(done.getByText(/^0 of \d+ translated/).first()).toBeVisible();
  await shot(page, "413-app-languages");

  await web.goto(`${WEB}/admin/languages`);
  await expect(web.getByRole("checkbox", { name: "German · Deutsch" })).toBeChecked();
  await expect(web.getByRole("checkbox", { name: "French · Français" })).toBeChecked();
  await expect(web.getByRole("checkbox", { name: "Spanish · Español" })).not.toBeChecked();
});

test("a product quiz written in the app gives shoppers the products that fit", async ({ page, browser }) => {
  const id = `qz${Date.now()}`;
  const { web, email } = await merchant(browser, id);
  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Product quiz/ }).click();
  await expect(page.getByText(/your products have none yet/)).toBeVisible();

  for (const [title, tags] of [["Straw Sun Hat", "summer, adults"], ["Kids Sun Hat", "summer, kids"], ["Wool Scarf", "winter, adults"]] as const) {
    await web.goto(`${WEB}/admin/products/new`);
    await web.getByLabel("Title").fill(title);
    await web.getByLabel("Price", { exact: true }).fill("20.00");
    await web.getByLabel("Tags", { exact: true }).fill(tags);
    await web.getByRole("button", { name: "Save product" }).click();
    await expect(web.getByText("Product added.")).toBeVisible();
  }
  await page.getByRole("link", { name: "← Products" }).click();
  await page.getByRole("link", { name: /^Product quiz/ }).click();
  await page.getByRole("textbox", { name: "Quiz title" }).last().fill("Find your hat");
  await page.getByRole("textbox", { name: "Question 1", exact: true }).last().fill("When will you wear it?");
  await page.getByRole("textbox", { name: "Answers to question 1" }).last().fill("In the sun: summer\nIn the cold: snow");
  await page.getByRole("button", { name: "Add a question" }).last().click();
  await page.getByRole("textbox", { name: "Question 2", exact: true }).last().fill("Who's it for?");
  await page.getByRole("textbox", { name: "Answers to question 2" }).last().fill("Me: adults\nMy kids: kids");
  await page.getByRole("button", { name: "Save the quiz" }).last().click();
  await expect(page.getByText('No product is tagged "snow" yet. Tag some products first, or pick a tag you use.')).toBeVisible();
  await page.getByRole("textbox", { name: "Answers to question 1" }).last().fill("In the sun: summer\nIn the cold: winter");
  await page.getByRole("button", { name: "Save the quiz" }).last().click();
  await expect(page.getByText("Saved. Shoppers can take the quiz now.")).toBeVisible();
  await expect(page.getByText(/^https?:\/\/\S+\/quiz$/).last()).toBeVisible();
  await shot(page, "414-app-quiz");

  const shopper = await (await browser.newContext()).newPage();
  await shopper.goto(`${WEB}/s/pocket-shop-${id}/quiz`);
  await expect(shopper.getByRole("heading", { name: "Find your hat" })).toBeVisible();
  await shopper.getByRole("group", { name: "When will you wear it?" }).getByText("In the sun").click();
  await shopper.getByRole("group", { name: "Who's it for?" }).getByText("My kids").click();
  await shopper.getByRole("button", { name: "See my picks" }).click();
  const picks = shopper.getByRole("region", { name: "Your picks" });
  await expect(picks.getByRole("link", { name: /Sun Hat/ }).first()).toHaveText(/Kids Sun Hat/);
  await expect(picks.getByText("Wool Scarf")).toHaveCount(0);

  await page.getByRole("button", { name: "Remove the quiz…" }).last().click();
  await page.getByRole("button", { name: "Remove the quiz now" }).last().click();
  await expect(page.getByText("Quiz removed.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Quiz title" }).last()).toHaveValue("");
});

test("a spammy search listing fixed from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sl${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("HOT SALE Sunset Lamp Free Shipping");
  await web.getByLabel("Price", { exact: true }).fill("25.00");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  const productUrl = web.url();

  await signIn(page, email);
  await tab(page, "Products");
  await page.getByRole("link", { name: /^Search listings/ }).click();
  await expect(page.getByText("1 product needs a look")).toBeVisible();
  await page.getByRole("link", { name: /^Fix HOT SALE Sunset Lamp Free Shipping: Supplier filler/ }).click();
  await expect(page.getByRole("heading", { name: "Search listing", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { name: "Headline in search results" }).fill("Sunset Lamp that fills a room with golden light");
  await page.getByRole("textbox", { name: "Snippet in search results" }).fill("A projector lamp that casts a warm sunset glow on your wall. USB powered, with a turning head.");
  await expect(page.getByText("Sunset Lamp that fills a room with golden light", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save search listing" }).click();
  await expect(page.getByText("Saved. Search engines pick it up next time they visit.")).toBeVisible();
  await shot(page, "415-app-search-listing");

  await page.getByRole("link", { name: "← Search listings" }).click();
  // Still no photo, but the filler and the missing snippet are gone.
  const row = page.getByRole("link", { name: /^Fix HOT SALE Sunset Lamp Free Shipping:/ }).last();
  await expect(row).toContainText("Sunset Lamp that fills a room with golden light");
  await expect(row).toContainText("No photo");
  await expect(row).not.toContainText("filler");

  await web.goto(productUrl);
  await expect(web.getByLabel("Headline in search results")).toHaveValue("Sunset Lamp that fills a room with golden light");
});

test("taxes and import duties set from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `tx${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Taxes and duties/ }).click();
  await expect(page.getByText("Nowhere yet")).toBeVisible();
  await expect(page.getByText("No tax collected in this period")).toBeVisible();

  await page.getByRole("button", { name: "Add United Kingdom (VAT)" }).click();
  await expect(page.getByText(/Sellers outside the UK must register/)).toBeVisible();
  await page.getByRole("textbox", { name: "Registration number (optional)" }).fill("GB123456789");
  await page.getByRole("button", { name: "Add registration" }).click();
  await expect(page.getByText("Added. Buyers there are charged tax from their next order.")).toBeVisible();
  await expect(page.getByText("GB123456789")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add United Kingdom (VAT)" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Include tax" }).click();
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText("Saved. Your prices include tax.")).toBeVisible();
  await page.getByRole("tab", { name: "Included" }).click();
  await expect(page.getByText(/there's nothing more to pay when it arrives/)).toBeVisible();
  await page.getByRole("button", { name: "Save import duties" }).click();
  await expect(page.getByText("Saved. Checkout and your shipping policy follow it.")).toBeVisible();
  await page.getByRole("tab", { name: "Last quarter" }).click();
  await expect(page.getByRole("region", { name: /^Tax collected, Q\d \d{4}$/ })).toBeVisible();
  await shot(page, "416-app-taxes");

  await web.goto(`${WEB}/admin/taxes`);
  await expect(web.getByText("United Kingdom (VAT)")).toBeVisible();
  await expect(web.getByRole("radio", { name: /^Include tax/ })).toBeChecked();
  await expect(web.getByRole("radio", { name: /^They're included in my prices/ })).toBeChecked();

  await page.getByRole("button", { name: "Stop collecting tax in United Kingdom (VAT)" }).click();
  await expect(page.getByText("Removed. Buyers there aren't charged tax any more.")).toBeVisible();
  await expect(page.getByText("Nowhere yet")).toBeVisible();
});

test("sales channel feed links and ad tracking from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `ch${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Google, Facebook, Pinterest and TikTok/ }).click();
  await expect(page.getByText(/^0 products \(0 options\) in your feeds/)).toBeVisible();
  const google = page.getByRole("region", { name: "Google Shopping" });
  await expect(google.getByRole("button", { name: "Share the Google Shopping feed link" })).toContainText(/\/feeds\/google\.xml$/);
  await expect(page.getByRole("region", { name: "Facebook and Instagram" }).getByRole("button", { name: /feed link/ })).toContainText(/\/feeds\/meta\.csv$/);
  await expect(page.getByText("Nothing. Every product on your store is in the feeds.")).toBeVisible();

  const ads = page.getByRole("region", { name: "Ad tracking" });
  await ads.getByRole("textbox", { name: "Meta pixel ID" }).fill("1234567890123456");
  await ads.getByRole("textbox", { name: "Google tag ID" }).fill("G-ABC123DEF4");
  await ads.getByRole("tab", { name: "Only where the law requires" }).click();
  await ads.getByRole("button", { name: "Save ad tracking" }).click();
  await expect(page.getByText("Saved. Your store now reports views, carts, checkouts and orders to these tags.")).toBeVisible();
  await shot(page, "417-app-channels");

  await web.goto(`${WEB}/admin/channels`);
  await expect(web.getByLabel("Meta pixel ID")).toHaveValue("1234567890123456");
  await expect(web.getByLabel("Google tag ID")).toHaveValue("G-ABC123DEF4");
  await expect(web.getByRole("radio", { name: /^Only visitors in the EU/ })).toBeChecked();

  await ads.getByRole("textbox", { name: "Meta pixel ID" }).fill("");
  await ads.getByRole("textbox", { name: "Google tag ID" }).fill("");
  await ads.getByRole("button", { name: "Save ad tracking" }).click();
  await expect(page.getByText("Saved. No ad tags are loaded on your store.")).toBeVisible();
});

test("invoice details set from the app, with the invoices issued", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `iv${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Beeswax Candle");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();
  await buy(browser, new URL((await web.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, WEB).href);

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Invoices/ }).click();
  await expect(page.getByText(/^Most tax offices need your registered business name/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Invoice INV-0001, order #1001" })).toBeVisible();
  await expect(page.getByText("The next one will be INV-0002. Tax numbers come from Taxes and duties.")).toBeVisible();

  await page.getByRole("textbox", { name: "Registered business name" }).fill("Pocket Candles LLC");
  await page.getByRole("textbox", { name: "Business address" }).fill("12 Main St\nAustin, TX 78701");
  await page.getByRole("textbox", { name: "Next number" }).fill("1");
  await page.getByRole("button", { name: "Save invoice details" }).click();
  await expect(page.getByText("The next number can't go below 2: numbers up to 1 are already used.")).toBeVisible();
  await page.getByRole("textbox", { name: "Number prefix" }).fill("PC-");
  await page.getByRole("textbox", { name: "Next number" }).fill("100");
  await page.getByRole("button", { name: "Save invoice details" }).click();
  await expect(page.getByText("Invoice settings saved. New invoices use them.")).toBeVisible();
  await expect(page.getByText("The next one will be PC-0100. Tax numbers come from Taxes and duties.")).toBeVisible();
  await expect(page.getByText(/^Most tax offices need/)).toHaveCount(0);
  await shot(page, "418-app-invoices");

  await page.getByRole("link", { name: "Invoice INV-0001, order #1001" }).click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await web.goto(`${WEB}/admin/invoices`);
  await expect(web.getByLabel("Registered business name")).toHaveValue("Pocket Candles LLC");
  await expect(web.getByLabel("Next number")).toHaveValue("100");
});

test("custom domains connected and swapped from the app", async ({ page, browser }) => {
  const id = `dm${Date.now()}`;
  const { web, email } = await merchant(browser, id);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Domains/ }).click();
  await expect(page.getByText(new RegExp(`pocket-shop-${id}`)).first()).toBeVisible();

  // Tests skip the DNS lookup, so a domain connects as soon as it's added.
  const box = page.getByRole("textbox", { name: "Domain you own" });
  await box.fill(`shop.${id}.com`);
  await page.getByRole("button", { name: "Connect domain" }).click();
  await expect(page.getByText(`Connected. Buyers can shop at https://shop.${id}.com.`)).toBeVisible();
  const first = page.getByRole("region", { name: `shop.${id}.com` });
  await expect(first.getByText("Main address", { exact: true })).toBeVisible();
  await box.fill(`https://www.${id}.com/`);
  await page.getByRole("button", { name: "Connect domain" }).click();
  const second = page.getByRole("region", { name: `www.${id}.com` });
  await second.getByRole("button", { name: `Make www.${id}.com the main address` }).click();
  await expect(page.getByText(`www.${id}.com is now your main address.`)).toBeVisible();
  await expect(second.getByText("Main address", { exact: true })).toBeVisible();
  await expect(first.getByText("Main address", { exact: true })).toHaveCount(0);
  await shot(page, "419-app-domains");

  await first.getByRole("button", { name: `Remove shop.${id}.com…` }).click();
  await first.getByRole("button", { name: `Remove shop.${id}.com now` }).click();
  await expect(page.getByText("Domain removed. Your free address still works.")).toBeVisible();
  await expect(page.getByRole("region", { name: `shop.${id}.com` })).toHaveCount(0);

  await web.goto(`${WEB}/admin/domains`);
  await expect(web.getByRole("heading", { name: `www.${id}.com` })).toBeVisible();
  await expect(web.getByRole("heading", { name: `shop.${id}.com` })).toHaveCount(0);
});

test("checkout add-ons, free gift and tips set from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `ad${Date.now()}`);
  for (const [title, price] of [["Phone Stand", "12.00"], ["Beeswax Candle", "8.00"]] as const) {
    await web.goto(`${WEB}/admin/products/new`);
    await web.getByLabel("Title").fill(title);
    await web.getByLabel("Price", { exact: true }).fill(price);
    await web.getByRole("button", { name: "Save product" }).click();
    await expect(web.getByText("Product added.")).toBeVisible();
  }

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Add-ons, free gift and tips/ }).click();
  await expect(page.getByText("No add-ons yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Product to offer" }).fill("stand");
  await page.getByRole("button", { name: "Pick Phone Stand" }).click();
  await page.getByRole("textbox", { name: "One line for buyers (optional)" }).fill("Keeps your phone up");
  await page.getByRole("button", { name: "Add add-on" }).click();
  await expect(page.getByText("Add-on saved. Buyers see it at checkout.")).toBeVisible();
  await expect(page.getByText("Phone Stand · 10% off")).toBeVisible();
  await expect(page.getByText("At checkout", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn off Phone Stand" }).click();
  await expect(page.getByText("Add-on turned off.")).toBeVisible();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();

  const gift = page.getByRole("region", { name: "Free gift" });
  await gift.getByRole("switch", { name: "Give a free gift with bigger orders" }).click();
  await gift.getByRole("button", { name: /^Pick Beeswax Candle/ }).click();
  await gift.getByRole("textbox", { name: /^For orders over/ }).fill("fifty");
  await gift.getByRole("button", { name: "Save free gift" }).click();
  await expect(page.getByText("Enter the order amount, like 75.00.")).toBeVisible();
  await gift.getByRole("textbox", { name: /^For orders over/ }).fill("50");
  await gift.getByRole("button", { name: "Save free gift" }).click();
  await expect(page.getByText("Saved. Carts show how much more it takes, and the gift is added once they get there.")).toBeVisible();

  const tips = page.getByRole("region", { name: "Tips" });
  await tips.getByRole("switch", { name: "Ask for a tip at checkout" }).click();
  await tips.getByRole("textbox", { name: "Tip choices (% of the order)" }).fill("5, 10");
  await tips.getByRole("button", { name: "Save tips" }).click();
  await expect(page.getByText("Saved. Checkout asks buyers if they'd like to tip.")).toBeVisible();
  await shot(page, "420-app-addons");

  await web.goto(`${WEB}/admin/addons`);
  await expect(web.getByRole("listitem", { name: "Phone Stand" })).toContainText("Off");
  await expect(web.getByLabel("For orders over")).toHaveValue("50.00");
  await expect(web.getByLabel("Tip choice 1")).toHaveValue("5");
  await expect(web.getByLabel("Tip choice 2")).toHaveValue("10");

  await page.getByRole("button", { name: "Delete Phone Stand" }).click();
  await expect(page.getByText("Add-on deleted.")).toBeVisible();
  await expect(page.getByText("No add-ons yet").last()).toBeVisible();
});

test("your account from the app: Monday summary and signing out another device", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `ac${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Your account" }).click();
  await expect(page.getByText(`Signed in as ${email}. These settings are yours, on every store you work on.`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Two-step sign-in" }).getByText("Off", { exact: true })).toBeVisible();

  const summary = page.getByRole("region", { name: "Monday summary" });
  await summary.getByRole("switch", { name: /^Email me a summary of Pocket Shop/ }).click();
  await summary.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved\. You won't get Pocket Shop \S+'s summary any more\.$/)).toBeVisible();

  const devices = page.getByRole("region", { name: "Where you're signed in" });
  await expect(devices.getByText("This device")).toBeVisible();
  await expect(devices.getByRole("button", { name: "Sign out everywhere else" })).toHaveCount(0);
  await shot(page, "421-app-account");
  await devices.getByRole("button", { name: /^Sign out / }).click();
  await expect(page.getByText("Signed out. That device has to sign in again.")).toBeVisible();
  await expect(devices.getByRole("button", { name: /^Sign out / })).toHaveCount(0);

  await web.goto(`${WEB}/admin/account`);
  await expect(web.getByRole("button", { name: "Sign in" })).toBeVisible();
  await web.getByLabel("Email").fill(email);
  await web.getByLabel("Password").fill(PASSWORD);
  await web.getByRole("button", { name: "Sign in" }).click();
  await expect(web).toHaveURL(/\/admin$/);
  await web.goto(`${WEB}/admin/account`);
  await expect(web.getByRole("checkbox", { name: /^Email me a summary/ })).not.toBeChecked();
});

test("API keys revoked and webhooks tested and paused from the app", async ({ page, browser }) => {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  try {
    const { web, email } = await merchant(browser, `dv${Date.now()}`);
    await web.goto(`${WEB}/admin/developers`);
    await web.getByLabel("Key name").fill("Reporting");
    await web.getByRole("button", { name: "Create key" }).click();
    await expect(web.getByText("Copy the key for Reporting now.")).toBeVisible();
    await web.getByLabel("Address").fill(hookUrl);
    await web.getByRole("button", { name: "Add webhook" }).click();
    await expect(web.getByRole("article", { name: `Webhook ${hookUrl}` })).toBeVisible();

    await signIn(page, email);
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("link", { name: /^API keys and webhooks/ }).click();
    await expect(page.getByText(/^Reporting · sfk_\S+…$/)).toBeVisible();
    await expect(page.getByText("Last used never")).toBeVisible();

    const hook = page.getByRole("region", { name: hookUrl });
    await hook.getByRole("button", { name: `Send a test to ${hookUrl}` }).click();
    await expect(page.getByText("Delivered. Your server answered 200.")).toBeVisible();
    await hook.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Webhook paused. Nothing is sent until you turn it back on.")).toBeVisible();
    await expect(hook.getByText("Paused", { exact: true })).toBeVisible();
    await shot(page, "422-app-developers");

    await page.getByRole("button", { name: "Revoke Reporting…" }).click();
    await page.getByRole("button", { name: "Revoke Reporting now" }).click();
    await expect(page.getByText("Reporting revoked. Anything using it stops working now.")).toBeVisible();
    await expect(page.getByText("No keys yet")).toBeVisible();

    await web.reload();
    await expect(web.getByText("No keys yet.")).toBeVisible();
    await expect(web.getByRole("article", { name: `Webhook ${hookUrl}` }).getByText("Paused")).toBeVisible();
  } finally {
    server.close();
  }
});

test("win-back and birthday codes set from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `wb${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("button", { name: "Discount codes" }).click();
  await page.getByRole("link", { name: /^Win-back and birthday codes/ }).click();
  await expect(page.getByText("No subscriber has added their birthday yet.")).toBeVisible();

  const winback = page.getByRole("region", { name: "Win-back emails" });
  await winback.getByRole("switch", { name: "Email a code to subscribers who haven't ordered in a while" }).click();
  await winback.getByRole("tab", { name: "90 days" }).click();
  await winback.getByRole("textbox", { name: "Percent off" }).fill("70");
  await winback.getByRole("button", { name: "Save win-back emails" }).click();
  await expect(page.getByText("The win-back offer is 5% to 50% off.")).toBeVisible();
  await winback.getByRole("textbox", { name: "Percent off" }).fill("20");
  await winback.getByRole("button", { name: "Save win-back emails" }).click();
  await expect(page.getByText("Saved. Codes go out with the daily emails.")).toBeVisible();
  await expect(page.getByText("Nobody is due one right now.")).toBeVisible();

  const birthday = page.getByRole("region", { name: "Birthday codes" });
  await birthday.getByRole("switch", { name: "Email subscribers a code on their birthday" }).click();
  await birthday.getByRole("textbox", { name: "Birthday percent off" }).fill("25");
  await birthday.getByRole("textbox", { name: "Days to use the birthday code" }).fill("10");
  await birthday.getByRole("button", { name: "Save birthday codes" }).click();
  await expect(page.getByText("Saved. Codes go out with the daily emails.")).toBeVisible();
  await expect(birthday.getByText("Codes sent", { exact: true })).toBeVisible();
  await shot(page, "423-app-winback");

  await web.goto(`${WEB}/admin/marketing`);
  await expect(web.getByLabel("After their last order")).toHaveValue("90");
  await expect(web.getByLabel("Percent off", { exact: true })).toHaveValue("20");
  await expect(web.getByLabel("Birthday percent off")).toHaveValue("25");
  await expect(web.getByLabel("Days to use the birthday code")).toHaveValue("10");
});

test("thank-you note, after-checkout offer and subscribe and save set from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `ao${Date.now()}`);
  await web.goto(`${WEB}/admin/products/new`);
  await web.getByLabel("Title").fill("Phone Stand");
  await web.getByLabel("Price", { exact: true }).fill("12.00");
  await web.getByRole("button", { name: "Save product" }).click();
  await expect(web.getByText("Product added.")).toBeVisible();

  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^After the order/ }).click();

  await page.getByRole("textbox", { name: "Thank-you note" }).fill("Follow us on Instagram @pocketshop.");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Saved. Buyers see it right after paying and in the confirmation email.")).toBeVisible();

  const offer = page.getByRole("region", { name: "After-checkout offer" });
  await offer.getByRole("switch", { name: "Offer one more product right after checkout" }).click();
  await offer.getByRole("button", { name: "Save after-checkout offer" }).click();
  await expect(page.getByText("Pick a product to offer.")).toBeVisible();
  await offer.getByRole("button", { name: "Pick Phone Stand" }).click();
  await offer.getByRole("textbox", { name: "Buyer saves (%)" }).fill("20");
  await offer.getByRole("button", { name: "Save after-checkout offer" }).click();
  await expect(page.getByText("Saved. Buyers see it on their order page right after paying.")).toBeVisible();
  await expect(offer.getByText("Added 0 times · $0.00 in extra sales")).toBeVisible();

  const sub = page.getByRole("region", { name: "Subscribe and save" });
  await sub.getByRole("switch", { name: "Let buyers subscribe to their order" }).click();
  await sub.getByRole("textbox", { name: "Subscriber saves (%)" }).fill("15");
  await sub.getByRole("button", { name: "Save subscribe and save" }).click();
  await expect(page.getByText("Saved. Buyers see the offer on their order page after paying.")).toBeVisible();
  await shot(page, "424-app-after-order");

  await web.goto(`${WEB}/admin/marketing`);
  await expect(web.locator("#thankYouNote")).toHaveValue("Follow us on Instagram @pocketshop.");
  await expect(web.getByLabel("Product to offer")).toHaveValue(/.+/);
  await expect(web.getByLabel("Buyer saves (%)")).toHaveValue("20");
  await expect(web.getByLabel("Subscriber saves (%)")).toHaveValue("15");
});

test("refer a friend set from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `rf${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("button", { name: "Discount codes" }).click();
  await page.getByRole("link", { name: /^Refer a friend/ }).click();
  await expect(page.getByText("0 friends sent a code · 0 orders · $0.00 in sales")).toBeVisible();

  await page.getByRole("switch", { name: "Let buyers refer friends" }).click();
  await page.getByRole("textbox", { name: "Friend's percent off" }).fill("80");
  await page.getByRole("button", { name: "Save refer a friend" }).click();
  await expect(page.getByText("Friends get 5% to 50% off.")).toBeVisible();
  await page.getByRole("textbox", { name: "Friend's percent off" }).fill("15");
  await page.getByRole("textbox", { name: /^Credit for the buyer/ }).fill("ten");
  await page.getByRole("button", { name: "Save refer a friend" }).click();
  await expect(page.getByText("Enter the credit like 10.00.")).toBeVisible();
  await page.getByRole("textbox", { name: /^Credit for the buyer/ }).fill("7.50");
  await page.getByRole("textbox", { name: /^Friend's minimum order/ }).fill("30");
  await page.getByRole("button", { name: "Save refer a friend" }).click();
  await expect(page.getByText("Saved. Buyers see their link on their order page and account.")).toBeVisible();
  await shot(page, "425-app-referrals");

  await web.goto(`${WEB}/admin/marketing`);
  await expect(web.getByLabel("Friend's percent off")).toHaveValue("15");
  await expect(web.getByLabel(/^Credit for the buyer/)).toHaveValue("7.50");
  await expect(web.getByLabel(/^Friend's minimum order/)).toHaveValue("30.00");

  await page.getByRole("switch", { name: "Let buyers refer friends" }).click();
  await page.getByRole("button", { name: "Save refer a friend" }).click();
  await expect(page.getByText("Turned off. Friends' codes already sent still work, but no more credit is sent.")).toBeVisible();
});

test("browse reminders turned on and off from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `br${Date.now()}`);
  await signIn(page, email);
  await tab(page, "Orders");
  await page.getByRole("tab", { name: "All" }).click();
  await page.getByRole("link", { name: /Left at checkout/ }).click();
  const browse = page.getByRole("region", { name: "Browse reminders" });
  await expect(browse.getByText("Last 30 days: 0 buyers reminded · 0 orders from them · $0.00")).toBeVisible();
  // Off for a new store.
  const toggle = browse.getByRole("switch", { name: "Send browse reminders" });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await browse.getByRole("button", { name: "Save browse reminders" }).click();
  await expect(browse.getByText(/^Saved\. Subscribers who look at a product and don't buy it get one email about \d+ hours later\.$/)).toBeVisible();
  await shot(page, "426-app-browse-reminders");
  await web.goto(`${WEB}/admin/marketing`);
  await expect(web.getByRole("checkbox", { name: "Send browse reminders" })).toBeChecked();

  await toggle.click();
  await browse.getByRole("button", { name: "Save browse reminders" }).click();
  await expect(browse.getByText("Saved. No browse reminders are sent.")).toBeVisible();
  await web.reload();
  await expect(web.getByRole("checkbox", { name: "Send browse reminders" })).not.toBeChecked();
});

test("shipping zones and rates set up from the app", async ({ page, browser }) => {
  const { web, email } = await merchant(browser, `sz${Date.now()}`);
  await signIn(page, email);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /^Shipping rates/ }).click();
  await expect(page.getByText(/to every country\. Set up zones to charge by country/)).toBeVisible();
  await page.getByRole("button", { name: "Set up shipping zones" }).click();
  await expect(page.getByText("Zones set up. Change their rates and countries below.")).toBeVisible();

  const home = page.getByRole("region", { name: "United States" });
  await expect(home.getByText("Standard · $4.99 · free over $50.00")).toBeVisible();
  await home.getByRole("button", { name: "Remove Express from United States" }).click();
  await expect(page.getByText("Rate removed.")).toBeVisible();
  await home.getByRole("button", { name: "Add a rate to United States" }).click();
  await home.getByRole("textbox", { name: "Rate name" }).fill("Overnight");
  await home.getByRole("textbox", { name: /^Price/ }).fill("19.99");
  await home.getByRole("textbox", { name: "Days from" }).fill("1");
  await home.getByRole("textbox", { name: "Days to" }).fill("one");
  await home.getByRole("button", { name: "Add rate" }).click();
  await expect(page.getByText("Enter delivery days as whole numbers.")).toBeVisible();
  await home.getByRole("textbox", { name: "Days to" }).fill("1");
  await home.getByRole("button", { name: "Add rate" }).click();
  await expect(page.getByText("Rate added. Buyers can pick it at checkout.")).toBeVisible();
  await expect(home.getByText("Overnight · $19.99")).toBeVisible();
  await expect(home.getByText("1 day", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /^Add a zone/ }).click();
  await page.getByRole("textbox", { name: "Zone name" }).fill("Australia and NZ");
  await expect(page.getByRole("switch", { name: "United States (in United States)" })).toBeDisabled();
  await page.getByRole("switch", { name: "Australia", exact: true }).click();
  await page.getByRole("switch", { name: "New Zealand", exact: true }).click();
  await page.getByRole("button", { name: "Add zone" }).click();
  const pacific = page.getByRole("region", { name: "Australia and NZ" }).last();
  await expect(pacific.getByText("No rates yet, so buyers in these countries can't check out.")).toBeVisible();
  await expect(pacific.getByText("Australia, New Zealand")).toBeVisible();
  await shot(page, "427-app-shipping-zones");

  await web.goto(`${WEB}/admin/shipping`);
  await expect(web.getByRole("listitem", { name: "Australia and NZ zone" })).toBeVisible();
  await expect(web.getByRole("listitem", { name: "United States: Overnight" })).toBeVisible();
  await expect(web.getByRole("listitem", { name: "United States: Express" })).toHaveCount(0);

  await pacific.getByRole("link", { name: "Edit the Australia and NZ zone" }).click();
  await page.getByRole("button", { name: "Delete zone…" }).click();
  await page.getByRole("button", { name: "Delete Australia and NZ now" }).click();
  await expect(page.getByRole("region", { name: "United States" }).last()).toBeVisible();
  await web.reload();
  await expect(web.getByRole("listitem", { name: "Australia and NZ zone" })).toHaveCount(0);
});
