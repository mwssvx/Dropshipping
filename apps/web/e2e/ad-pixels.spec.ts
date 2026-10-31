import { expect, test, type Page } from "@playwright/test";

// Ad tracking: the merchant pastes their Meta and Google IDs. Buyers are asked in a cookie banner
// first, and once they agree the store reports product views, carts, checkouts and purchases.
// The platforms' scripts are blocked here, so the calls stay in the tags' own queues to check.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};
const META = "1234567890123456";
/** What the store asked the Meta pixel to do, in order: ["init", id], ["track", "PageView"]... */
const metaCalls = (p: Page) => p.evaluate(() => ((window as unknown as { fbq?: { queue: unknown[][] } }).fbq?.queue ?? []).map((a) => a.slice(0, 2).join(" ")));

test("ad tags load after the buyer agrees and hear about the purchase once", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`px-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Ads ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Ads/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // A wrong ID is caught before it reaches the store.
  await page.goto("/admin/channels");
  const section = page.getByRole("region", { name: "Ad tracking" });
  await section.getByLabel("Meta pixel ID").fill("fb-123");
  await section.getByRole("button", { name: "Save ad tracking" }).click();
  await expect(section.getByRole("alert")).toContainText("A Meta pixel ID is 10 to 20 digits");
  await section.getByLabel("Meta pixel ID").fill(META);
  await section.getByLabel("Google tag ID").fill("g-abc123def4");
  await section.getByLabel("Pinterest tag ID").fill("2612345678901");
  await section.getByLabel("Only visitors in the EU, EEA, UK and Switzerland").check();
  await section.getByRole("button", { name: "Save ad tracking" }).click();
  await expect(section.getByText("Saved. Your store now reports views, carts, checkouts and orders to these tags.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Ad tracking" }).getByLabel("Google tag ID")).toHaveValue("G-ABC123DEF4");
  await shot(page, "361-ad-tracking-settings");

  // A buyer in Germany is asked first, and nothing loads until they agree.
  const context = await browser.newContext({ ...info.project.use, extraHTTPHeaders: { "x-vercel-ip-country": "DE" } });
  await context.route(/connect\.facebook\.net|googletagmanager\.com|analytics\.tiktok\.com|s\.pinimg\.com/, (r) => r.abort());
  const buyer = await context.newPage();
  await buyer.goto(store);
  const banner = buyer.getByRole("region", { name: "Cookie settings" });
  await expect(banner).toContainText("We use cookies to measure our ads");
  await shot(buyer, "362-cookie-banner");
  await banner.getByRole("button", { name: "Only necessary" }).click();
  await expect(banner).toHaveCount(0);
  expect(await metaCalls(buyer)).toEqual([]);
  // They change their mind from the link at the foot of the page.
  await buyer.getByRole("button", { name: "Cookie settings" }).click();
  await banner.getByRole("button", { name: "Accept" }).click();
  // What happened while they'd said no isn't sent afterwards.
  await expect.poll(() => metaCalls(buyer)).toEqual([`init ${META}`, "track PageView"]);

  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect.poll(async () => (await metaCalls(buyer)).includes("track AddToCart")).toBe(true);
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect.poll(async () => (await metaCalls(buyer)).includes("track InitiateCheckout")).toBe(true);
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect.poll(async () => (await metaCalls(buyer)).includes("track Purchase")).toBe(true);
  const purchase = await buyer.evaluate(() => (window as unknown as { fbq: { queue: unknown[][] } }).fbq.queue.find((a) => a[1] === "Purchase")![2] as { value: number; currency: string });
  expect(purchase.value).toBeGreaterThan(0);
  expect(purchase.currency).toBe("USD");
  // Google hears about it too.
  expect(await buyer.evaluate(() => (window as unknown as { dataLayer: IArguments[] }).dataLayer.some((a) => a[0] === "event" && a[1] === "purchase"))).toBe(true);
  // And Pinterest, as a checkout with the order's value.
  const pins = await buyer.evaluate(() => ((window as unknown as { pintrk?: { queue: unknown[][] } }).pintrk?.queue ?? []).map((a) => a.slice(0, 2).join(" ")));
  expect(pins[0]).toBe("load 2612345678901");
  expect(pins).toContain("track checkout");
  // Opening the order page again doesn't count a second sale.
  await buyer.reload();
  await expect.poll(() => metaCalls(buyer)).toEqual([`init ${META}`, "track PageView"]);

  // A buyer in the US isn't asked, since the store only asks where the law requires it.
  const us = await (await browser.newContext({ ...info.project.use, extraHTTPHeaders: { "x-vercel-ip-country": "US" } })).newPage();
  await us.context().route(/connect\.facebook\.net|googletagmanager\.com|analytics\.tiktok\.com|s\.pinimg\.com/, (r) => r.abort());
  await us.goto(store);
  await expect.poll(() => metaCalls(us)).toEqual([`init ${META}`, "track PageView", "track ViewContent"]);
  await expect(us.getByRole("region", { name: "Cookie settings" })).toHaveCount(0);
});
