import { test } from "@playwright/test";

// Captures reference screenshots for review. Run with SCREENSHOTS_DIR=<dir> pnpm e2e --project=desktop -g screens
test("screens", async ({ page, browser }) => {
  const dir = process.env.SCREENSHOTS_DIR;
  test.skip(!dir, "set SCREENSHOTS_DIR to capture");
  const shot = (name: string, p = page) => p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });

  await page.goto("/");
  await shot("01-landing");
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`demo-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill("Glow Lamps");
  await shot("02-new-store");
  await page.getByRole("button", { name: "Create store" }).click();
  await page.getByRole("heading", { name: /Welcome/ }).waitFor();
  await shot("03-admin-home-new");

  for (const [title, price, cost] of [["Sunset Lamp", "24.99", "8.00"], ["Moon Night Light", "32.00", "11.50"], ["Aurora Strip Lights", "19.50", "6.20"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Description").fill("Warm, dimmable light that turns any room golden.\nUSB powered.");
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByLabel("Your cost").fill(cost);
    if (title === "Sunset Lamp") await shot("04-product-editor");
    await page.getByRole("button", { name: "Save product" }).click();
    await page.getByText("Product added.").waitFor();
  }
  await page.goto("/admin/products");
  await shot("05-products");
  const href = (await page.locator("aside a", { hasText: "View store" }).getAttribute("href"))!;

  const buyerCtx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const buyer = await buyerCtx.newPage();
  await buyer.goto(href);
  await shot("06-store-home-phone", buyer);
  await buyer.getByRole("link", { name: /Sunset Lamp/ }).click();
  await shot("07-product-phone", buyer);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await shot("08-checkout-phone", buyer);
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await buyer.getByRole("heading", { name: /Thank you/ }).waitFor();
  await shot("09-order-status-phone", buyer);

  await page.goto("/admin");
  await shot("10-admin-home-with-order");
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).click();
  await page.getByText("Profit after supplier cost").waitFor();
  await shot("11-order-detail");
});

test("screens: dropshipping", async ({ page, browser }) => {
  const dir = process.env.SCREENSHOTS_DIR;
  test.skip(!dir, "set SCREENSHOTS_DIR to capture");
  const shot = (name: string, p = page) => p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });

  await page.goto("/signup");
  await page.getByLabel("Email").fill(`demo2-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill("Gadget Den");
  await page.getByRole("button", { name: "Create store" }).click();
  await page.getByRole("heading", { name: /Welcome/ }).waitFor();

  await page.goto("/admin/products");
  await shot("12-products-empty");
  const links: string[] = [];
  for (const name of [/sunset projection lamp/i, /galaxy projector low stock/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByText("From Demo supplier").waitFor();
    if (links.length === 0) await shot("13-import-preview");
    await page.getByRole("button", { name: "Import and publish" }).click();
    await page.getByText("Imported and live").waitFor();
    links.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  }
  await shot("14-imported-product");

  const buyer = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  const statusUrls: string[] = [];
  for (const link of links) {
    await buyer.goto(link);
    if (statusUrls.length === 0) await shot("15-product-options-phone", buyer);
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
    await buyer.getByRole("heading", { name: /Thank you/ }).waitFor();
    statusUrls.push(buyer.url());
  }
  await page.waitForTimeout(1500);
  await page.goto("/admin");
  await shot("16-home-problem");
  await page.goto("/admin/orders");
  await shot("17-orders");
  await page.goto((await page.getByRole("link", { name: "#1002" }).getAttribute("href"))!);
  await shot("18-problem-order");
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await page.getByText(/Shipped with/).waitFor();
  await shot("19-order-shipped");
  await buyer.goto(statusUrls[0]!);
  await shot("20-buyer-tracking-phone", buyer);
  await page.goto("/admin/suppliers");
  await shot("21-suppliers");
});

test("screens: storefront", async ({ page, browser }) => {
  const dir = process.env.SCREENSHOTS_DIR;
  test.skip(!dir, "set SCREENSHOTS_DIR to capture");
  const shot = (name: string, p = page, fullPage = true) => p.screenshot({ path: `${dir}/${name}.png`, fullPage });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`demo3-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill("Moonbeam Home");
  await page.getByRole("button", { name: "Create store" }).click();
  await page.getByRole("heading", { name: /Welcome/ }).waitFor();
  const store = "/s/moonbeam-home";

  for (const [title, price] of [["Moon Lamp", "34.99"], ["Cloud Night Light", "24.99"], ["Star Projector", "39.99"], ["Sunset Lamp", "29.99"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByRole("button", { name: "Save product" }).click();
    await page.getByText("Product added.").waitFor();
  }

  await page.goto("/admin/collections/new");
  await page.getByLabel("Title").fill("Best sellers");
  await page.getByLabel("Description").fill("The lights our customers come back for.");
  for (const name of [/Star Projector/, /Moon Lamp/]) await page.getByRole("button", { name }).click();
  await shot("22-collection-edit");
  await page.getByRole("button", { name: "Save collection" }).click();
  await page.getByText("Saved.").waitFor();

  await page.goto("/admin/pages");
  await shot("23-pages-empty");
  await page.getByRole("link", { name: "Shipping and returns" }).click();
  await page.getByLabel("Text").fill("Every order ships within 2 business days, with tracking.\n\nNot happy? Send it back within 30 days for a full refund.");
  await page.getByRole("button", { name: "Save page" }).click();
  await page.getByText("Saved.").waitFor();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await shot("24-theme-editor", page, false);
  await page.getByRole("button", { name: /Welcome to Moonbeam/ }).click();
  await page.getByLabel("Heading").fill("Soft light for slow evenings");
  await page.getByLabel("Text", { exact: true }).fill("Lamps and night lights that make any room feel calm.");
  await preview.getByRole("heading", { name: "Soft light for slow evenings" }).waitFor();
  await shot("25-theme-edit-section", page, false);
  await page.getByRole("button", { name: "← All sections" }).click();
  await page.getByLabel("Add a section").selectOption("collection_list");
  await page.getByLabel("Heading").fill("Shop by collection");
  await page.getByRole("button", { name: "← All sections" }).click();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByRole("button", { name: "Warm" }).click();
  await page.waitForTimeout(800);
  await shot("26-theme-style", page, false);
  await page.getByRole("tab", { name: "Menus" }).click();
  await page.getByLabel("Add a link").nth(1).selectOption({ label: "Shipping and returns" });
  await page.getByText("Draft saved. Not live yet.").waitFor();
  await shot("27-theme-menus", page, false);
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByText("Everything is live.").waitFor();

  const buyer = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await buyer.goto(store);
  await buyer.waitForLoadState("networkidle");
  await shot("28-store-home", buyer);
  await buyer.goto(`${store}/collections/best-sellers`);
  await shot("29-store-collection", buyer);
  await buyer.goto(`${store}/pages/shipping-and-returns`);
  await shot("30-store-page", buyer);

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  await phone.goto(store);
  await phone.waitForLoadState("networkidle");
  await shot("31-store-home-phone", phone);

  await page.goto("/admin/domains");
  await page.getByLabel("Domain you own").fill("www.moonbeam-home.com");
  await page.getByRole("button", { name: "Connect domain" }).click();
  await page.getByRole("heading", { name: "www.moonbeam-home.com" }).waitFor();
  await shot("32-domains");
});
