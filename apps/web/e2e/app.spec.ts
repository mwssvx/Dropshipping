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
