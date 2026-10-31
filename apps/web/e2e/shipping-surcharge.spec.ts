import { expect, test, type Page } from "@playwright/test";

// Extra shipping: a bulky product adds its own amount to every shipping rate, so the product page,
// cart and checkout show the real cost.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const dollars = (text: string) => Math.round(Number(/\$([\d.,]+)/.exec(text)?.[1]?.replace(/,/g, "") ?? "0") * 100);

test("bulky products add their extra shipping everywhere buyers see a price", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`xs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Rugs ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Rugs/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  const cost = buyer.locator("#shipping-cost");
  await expect(cost).toContainText("United States");
  const before = dollars((await cost.textContent()) ?? "");

  const extra = page.getByRole("region", { name: "Extra shipping" });
  await extra.getByLabel(/Extra shipping for each one/).fill("lots");
  await extra.getByRole("button", { name: "Save extra shipping" }).click();
  await expect(extra.getByRole("alert")).toContainText("Enter an amount like 15 or 15.50.");
  await extra.getByLabel(/Extra shipping for each one/).fill("25");
  await extra.getByRole("button", { name: "Save extra shipping" }).click();
  await expect(extra.getByRole("status")).toHaveText("Saved. Shipping on the product page, cart and checkout includes it.");
  await expect(extra.getByRole("note")).toHaveText("Buyers pay $25.00 more shipping for each one.");
  await shot(page, "314-extra-shipping");

  // The product page shows the rate with the extra on top, and no "free over" for it.
  await buyer.reload();
  await expect.poll(async () => dollars((await cost.textContent()) ?? "")).toBe(before + 2500);
  await expect(cost).not.toContainText("Free shipping over");

  // Two of them at checkout: each adds 25 to every rate.
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByLabel("Quantity").fill("2");
  await buyer.getByRole("button", { name: "Update" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 2 items/ })).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  const standard = buyer.getByRole("radio", { name: /Standard/ });
  await expect(standard).toBeChecked();
  await expect(buyer.locator("label", { has: standard })).toContainText("$54.99");
  await expect(buyer.locator("aside")).toContainText("Shipping (Standard)$54.99");
  await shot(buyer, "315-extra-shipping-checkout");
});
