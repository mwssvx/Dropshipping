import { expect, test, type Page } from "@playwright/test";

// Badges on product cards: the merchant's own ("Bestseller") and automatic ones worked out from the
// real price, stock and date.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("product cards show the merchant's badge and the automatic ones", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`badge-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Badge ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Badge/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const search = product.replace(/\/products\/.*$/, "/search");

  // The merchant's own badge.
  const section = page.getByRole("region", { name: "Badge", exact: true });
  await section.getByLabel("Badge text").evaluate((el) => el.removeAttribute("maxlength"));
  await section.getByLabel("Badge text").fill("Our most loved lamp of all");
  await section.getByRole("button", { name: "Save badge" }).click();
  await expect(section.getByText("Keep the badge to 20 characters, so it fits on the card.")).toBeVisible();
  await section.getByLabel("Badge text").fill("Bestseller");
  await section.getByRole("button", { name: "Save badge" }).click();
  await expect(section.getByText("Saved. The badge shows on this product's card and page.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(search);
  const card = buyer.getByRole("link", { name: /Sunset Projection Lamp/ });
  await expect(card.getByText("Bestseller", { exact: true })).toBeVisible();
  await expect(card.getByText("New", { exact: true })).toHaveCount(0);
  await buyer.goto(product);
  await expect(buyer.getByText("Bestseller", { exact: true })).toBeVisible();

  // "New" for products added in the last week.
  await page.goto("/admin/products");
  const settings = page.getByRole("region", { name: "Badges" });
  // Past the box's own limit (the browser would stop it), the server says so too.
  await settings.getByLabel("“New” for this many days").evaluate((el) => el.removeAttribute("max"));
  await settings.getByLabel("“New” for this many days").fill("91");
  await settings.getByRole("button", { name: "Save badges" }).click();
  await expect(settings.getByText('Show "New" for 0 to 90 days (0 turns it off).')).toBeVisible();
  await settings.getByLabel("“New” for this many days").fill("7");
  await settings.getByRole("button", { name: "Save badges" }).click();
  await expect(settings.getByText("Saved. Product cards show these badges now.")).toBeVisible();
  await buyer.goto(search);
  await expect(card.getByText("New", { exact: true })).toBeVisible();
  await shot(buyer, "391-badges-cards");
});
