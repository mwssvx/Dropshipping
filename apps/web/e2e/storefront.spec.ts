import { expect, test, type Page } from "@playwright/test";

// Milestone 3 "done when": a merchant restyles the home page without code, groups products,
// adds pages and menus, and the store answers on its own domain.

const PORT = 3100;

async function newMerchant(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`m3-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamp Loft ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamp Loft/ })).toBeVisible();
  return `/s/lamp-loft-${id}`;
}

async function addProduct(page: Page, title: string) {
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Price", { exact: true }).fill("24.99");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
}

test("the theme editor changes the home page only after publishing", async ({ page, browser }, info) => {
  test.skip(info.project.name === "phone", "The editor is a desktop tool; the store itself is tested on phones below.");
  const id = `${info.project.name}-${Date.now()}`;
  const store = await newMerchant(page, id);
  await addProduct(page, "Moon Lamp");

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await expect(preview.getByRole("heading", { name: /Welcome to Lamp Loft/ })).toBeVisible();

  await page.getByRole("button", { name: /Welcome to Lamp Loft/ }).click();
  await page.getByLabel("Heading").fill("Light up your evenings");
  await expect(preview.getByRole("heading", { name: "Light up your evenings" })).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();

  const buyer = await (await browser.newContext()).newPage();
  await buyer.goto(store);
  await expect(buyer.getByRole("heading", { name: /Welcome to Lamp Loft/ })).toBeVisible();
  await expect(buyer.getByRole("link", { name: /Moon Lamp/ })).toBeVisible();

  // Themes: switch to "Bold", keeping the sections.
  await page.getByRole("tab", { name: "Themes" }).click();
  await page.getByRole("button", { name: "Use Bold" }).click();
  await page.getByRole("tab", { name: "Style" }).click();
  await expect(page.getByLabel("Background", { exact: true })).toHaveValue("#0e0e10");

  // Undo brings the old background back, redo applies it again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Background", { exact: true })).toHaveValue("#ffffff");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByLabel("Background", { exact: true })).toHaveValue("#0e0e10");

  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await buyer.reload();
  await expect(buyer.getByRole("heading", { name: "Light up your evenings" })).toBeVisible();
  await expect(buyer.locator(".store")).toHaveCSS("background-color", "rgb(14, 14, 16)");
});

test("collections, pages and menus show up on the store, with search basics", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const store = await newMerchant(page, id);
  await addProduct(page, "Moon Lamp");
  await addProduct(page, "Desk Lamp");

  await page.goto("/admin/collections/new");
  await page.getByLabel("Title").fill("Best sellers");
  await page.getByRole("button", { name: /Desk Lamp/ }).click();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/admin/pages");
  await page.getByRole("link", { name: "Shipping and returns" }).click();
  await page.getByLabel("Text").fill("We ship in 2 days.\n\nReturns are free for 30 days.");
  await page.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto(`${store}/collections/best-sellers`);
  await expect(page.getByRole("heading", { name: "Best sellers" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Desk Lamp/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Moon Lamp/ })).toHaveCount(0);

  await page.goto(`${store}/pages/shipping-and-returns`);
  await expect(page.getByRole("heading", { name: "Shipping and returns" })).toBeVisible();
  await expect(page.getByText("Returns are free for 30 days.")).toBeVisible();
  await expect(page).toHaveTitle(/Shipping and returns/);

  // Product pages carry a description and structured data for search engines.
  await page.goto(`${store}/products/moon-lamp`);
  // Besides the product, the page describes its breadcrumb trail.
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t)).find((d) => d["@type"] === "Product");
  expect(ld).toMatchObject({ "@type": "Product", name: "Moon Lamp", offers: [{ price: "24.99" }] });
  // Shipping to the store's country and the return window, for Google's "Free delivery" and "30-day returns".
  expect(ld.offers[0].hasMerchantReturnPolicy).toMatchObject({ "@type": "MerchantReturnPolicy", merchantReturnDays: 30, returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow" });
  expect(ld.offers[0].shippingDetails).toMatchObject({ "@type": "OfferShippingDetails", shippingRate: { "@type": "MonetaryAmount" }, shippingDestination: { "@type": "DefinedRegion" } });

  const sitemap = await page.request.get(`${store}/sitemap.xml`);
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const xml = await sitemap.text();
  expect(xml).toContain("/collections/best-sellers");
  expect(xml).toContain("/pages/shipping-and-returns");
  expect(xml).toContain("/products/desk-lamp");
  expect(await (await page.request.get(`${store}/robots.txt`)).text()).toContain("Disallow:");
});

test.describe("custom domains", () => {
  // The browser resolves *.lamptest to this machine (playwright.config.ts), like real DNS would after setup.
  test("a connected domain serves the store with clean links, and checkout works there", async ({ page, browser }, info) => {
    const id = `${info.project.name}-${Date.now()}`;
    await newMerchant(page, id);
    await addProduct(page, "Moon Lamp");

    const domain = `shop-${info.project.name}.lamptest`;
    await page.goto("/admin/domains");
    await page.getByLabel("Domain you own").fill(`https://${domain}/`);
    await page.getByRole("button", { name: "Connect domain" }).click();
    await expect(page.getByRole("heading", { name: domain })).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText("Main address")).toBeVisible();
    await expect(page.getByRole("link", { name: "View store ↗" })).toHaveAttribute("href", `https://${domain}`);

    const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
    await buyer.goto(`http://${domain}:${PORT}/`);
    await expect(buyer.getByRole("heading", { name: /Welcome to Lamp Loft/ })).toBeVisible();
    const product = buyer.getByRole("link", { name: /Moon Lamp/ });
    await expect(product).toHaveAttribute("href", "/products/moon-lamp");
    await product.click();
    await buyer.getByRole("button", { name: "Add to cart" }).click();
    await expect(buyer).toHaveURL(`http://${domain}:${PORT}/cart`);
    await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();

    // An unknown domain is a plain 404, never someone else's store.
    const res = await buyer.goto(`http://unknown.lamptest:${PORT}/`);
    expect(res?.status()).toBe(404);
  });
});
