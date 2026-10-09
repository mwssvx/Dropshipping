import { expect, test, type Page } from "@playwright/test";

// Store languages: the merchant turns on German, the AI translator fills it in, the merchant fixes
// one title by hand, and a buyer shops the store in German from the footer.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant translates the store into German and a buyer shops in German", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`lang-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Polyglot ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Polyglot/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const productLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const storeRoot = productLink.replace(/\/products\/.*$/, "");

  // Turn on German, then let the AI translate everything.
  await page.goto("/admin/languages");
  await page.getByLabel(/German · Deutsch/).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Buyers can pick these languages at the bottom of the store.")).toBeVisible();
  const german = page.getByRole("region", { name: "German" });
  await expect(german.getByRole("progressbar", { name: "German translated" })).toHaveAttribute("aria-valuenow", "0");
  await german.getByRole("button", { name: "Translate into German with AI" }).click();
  await expect(german.getByRole("status")).toContainText("Everything is done");
  await page.reload();
  await expect(german.getByRole("progressbar", { name: "German translated" })).toHaveAttribute("aria-valuenow", "100");
  await shot(page, "126-languages");

  // The merchant reads it over and fixes the product title.
  await german.getByRole("link", { name: "Read and edit" }).click();
  await page.getByRole("link", { name: "Sunset Projection Lamp" }).click();
  await expect(page.getByLabel("Title, translated")).toHaveValue("[DE] Sunset Projection Lamp");
  await page.getByLabel("Title, translated").fill("Sonnenuntergangslampe");
  await shot(page, "127-translation-editor");
  await page.getByRole("button", { name: "Save translation" }).click();
  await expect(page.getByText("Translation saved. Buyers reading German see it now.")).toBeVisible();

  // A buyer switches to German in the footer and shops.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(storeRoot);
  await buyer.getByRole("navigation", { name: "Language" }).getByRole("link", { name: "Deutsch" }).click();
  await expect(buyer).toHaveURL(new RegExp(`${storeRoot}/de$`));
  await expect(buyer.locator("[lang=de]").first()).toBeVisible();
  await buyer.getByRole("link", { name: /Sonnenuntergangslampe/ }).first().click();
  await expect(buyer).toHaveURL(/\/de\/products\//);
  await expect(buyer.getByRole("heading", { name: "Sonnenuntergangslampe" })).toBeVisible();
  await shot(buyer, "128-store-in-german");
  await buyer.getByRole("button", { name: "In den Warenkorb" }).click();
  await expect(buyer).toHaveURL(/\/de\/cart$/);
  await expect(buyer.getByRole("heading", { name: "Dein Warenkorb" })).toBeVisible();
  await buyer.getByRole("link", { name: "Kasse" }).or(buyer.getByRole("button", { name: "Kasse" })).first().click();
  await expect(buyer.getByLabel("Vollständiger Name")).toBeVisible();
  await expect(buyer.getByRole("button", { name: "Weiter zur Zahlung" })).toBeVisible();

  // English is still one click away, on the same page.
  await buyer.getByRole("navigation", { name: "Sprache" }).getByRole("link", { name: "English" }).click();
  await expect(buyer.getByLabel("Full name")).toBeVisible();

  // A language the store doesn't offer is a 404.
  const res = await buyer.goto(`${storeRoot}/fr`);
  expect(res?.status()).toBe(404);
});
