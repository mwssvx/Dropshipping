import { expect, test } from "@playwright/test";

// Import duties: the merchant says who pays them, and buyers abroad read it at checkout. Orders
// inside the store's own country say nothing.

test("buyers abroad are told who pays import duties", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`duties-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Duties ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Duties/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const productAdmin = page.url();

  await page.goto("/admin/taxes");
  const duties = page.getByRole("region", { name: "Import duties" });
  await expect(duties.getByLabel(/Don't mention them/)).toBeChecked();
  await duties.getByLabel(/Buyers pay them on delivery/).check();
  await duties.getByRole("button", { name: "Save import duties" }).click();
  await expect(duties.getByRole("status")).toHaveText("Saved. Checkout and your shipping policy follow it.");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByLabel("Country")).toHaveValue("US");
  await expect(buyer.locator("#duties-note")).toHaveCount(0);
  await buyer.getByLabel("Country").selectOption("GB");
  await expect(buyer.locator("#duties-note")).toHaveText("Customs in United Kingdom may charge import duties or taxes when it arrives. They're paid to the courier and aren't part of this total.");

  await duties.getByLabel(/They're included in my prices/).check();
  await duties.getByRole("button", { name: "Save import duties" }).click();
  await expect(duties.getByRole("status")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Import duties" }).getByLabel(/They're included in my prices/)).toBeChecked();
  await buyer.reload();
  await buyer.getByLabel("Country").selectOption("GB");
  await expect(buyer.locator("#duties-note")).toHaveText("Import duties and taxes for United Kingdom are included. There's nothing more to pay when it arrives.");

  // Product pages say it too, for shoppers abroad.
  const uk = await (await browser.newContext({ ...info.project.use, extraHTTPHeaders: { "x-vercel-ip-country": "GB" } })).newPage();
  await uk.goto(store);
  await expect(uk.locator("#duties-line")).toHaveText("Import duties and taxes for United Kingdom included.");
  await duties.getByLabel(/Buyers pay them on delivery/).check();
  await duties.getByRole("button", { name: "Save import duties" }).click();
  await expect(duties.getByRole("status")).toBeVisible();
  await uk.reload();
  await expect(uk.locator("#duties-line")).toHaveText("Import duties and taxes for United Kingdom may be charged on delivery.");
  const home = await (await browser.newContext({ ...info.project.use, extraHTTPHeaders: { "x-vercel-ip-country": "US" } })).newPage();
  await home.goto(store);
  await expect(home.locator("#shipping-cost")).toBeVisible();
  await expect(home.locator("#duties-line")).toHaveCount(0);
  await expect(home.locator("#ships-from")).toHaveCount(0);

  // Shipped from a warehouse in China, buyers at home pay duties too.
  await page.goto(productAdmin);
  const customs = page.getByRole("region", { name: "Customs" });
  await customs.getByLabel("Ships from (country code)").fill("XX");
  await customs.getByRole("button", { name: "Save customs info" }).click();
  await expect(customs.getByRole("alert")).toContainText("Enter the country it ships from as a two-letter code");
  await customs.getByLabel("Ships from (country code)").fill("cn");
  await customs.getByRole("button", { name: "Save customs info" }).click();
  await expect(customs.getByRole("status")).toHaveText("Saved. Customs forms and duty notes for this product now use it.");
  await expect(customs.getByRole("note")).toHaveText("Ships from China.");
  await home.reload();
  await expect(home.locator("#ships-from")).toHaveText("Ships from China");
  await expect(home.locator("#duties-line")).toHaveText("Import duties and taxes for United States may be charged on delivery.");
  await buyer.reload();
  await buyer.getByLabel("Country").selectOption("US");
  await expect(buyer.locator("#duties-note")).toHaveText("Customs in United States may charge import duties or taxes when it arrives. They're paid to the courier and aren't part of this total.");
});
