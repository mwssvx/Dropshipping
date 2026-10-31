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
  await page.getByRole("textbox", { name: "Price" }).fill("24.00");
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
  await page.getByRole("button", { name: "Reviews" }).click();
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
