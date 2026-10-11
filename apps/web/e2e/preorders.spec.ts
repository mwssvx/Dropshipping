import { expect, test, type Page } from "@playwright/test";

// Pre-orders: the merchant keeps selling a sold-out product with a ship-by date. Buyers see the
// date before they pay, and the order waits for stock instead of going to the supplier.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a sold-out product takes pre-orders that wait for stock", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pre-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Soon ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Soon/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const productUrl = page.url().replace(/\?.*$/, "");
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // Every option sells out.
  await expect(page.locator("#stock-0")).toHaveValue(/^\d+$/);
  await page.locator("#stock-0").fill("0");
  await page.locator("#stock-1").fill("0");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toHaveCount(0);

  // The merchant takes pre-orders, shipping in three weeks. A date too far out is refused.
  await page.goto(productUrl);
  const section = page.getByRole("region", { name: "Pre-orders" });
  await section.getByLabel("Take pre-orders while it's sold out").check();
  const far = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  await section.getByLabel("Ships by").evaluate((el, v) => ((el as HTMLInputElement).max = "", (el as HTMLInputElement).value = v), far);
  await section.getByRole("button", { name: "Save pre-orders" }).click();
  await expect(section.getByRole("alert")).toContainText("Pre-orders can promise up to 120 days ahead.");
  const shipsBy = new Date(Date.now() + 21 * 86_400_000);
  await section.getByLabel("Ships by").fill(shipsBy.toISOString().slice(0, 10));
  await section.getByLabel("Most pre-orders").fill("50");
  await section.getByRole("button", { name: "Save pre-orders" }).click();
  await expect(section.getByText("Saved. Sold-out options can now be pre-ordered.")).toBeVisible();
  const long = shipsBy.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const short = shipsBy.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  await page.reload();
  await expect(page.getByRole("region", { name: "Pre-orders" }).getByRole("note")).toHaveText(`0 pre-orders so far of 50. Ships by ${short}.`);
  await shot(page, "331-preorder-settings");

  // The buyer sees the date before paying, all the way through.
  await buyer.goto(store);
  await expect(buyer.getByText(`Pre-order: ships by ${long}`)).toBeVisible();
  await shot(buyer, "332-preorder-product");
  await buyer.getByRole("button", { name: "Pre-order" }).click();
  await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(buyer.getByText(`Pre-order: ships by ${long}`)).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByText(`Pre-order: ships by ${long}`)).toBeVisible();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByText(`This is a pre-order. It ships by ${short}`)).toBeVisible();
  await shot(buyer, "333-preorder-order");

  // The merchant sees it waiting for stock, not sent to the supplier.
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/[^/]+$/);
  const waiting = page.getByRole("region", { name: "Pre-order: waiting for stock" });
  await expect(waiting).toContainText(`Promised to ship by ${short}.`);
  await expect(page.getByText("Pre-order", { exact: true })).toBeVisible();
  await shot(page, "334-preorder-admin-order");

  await page.goto(productUrl);
  await expect(page.getByRole("region", { name: "Pre-orders" }).getByRole("note")).toHaveText(`1 pre-order so far of 50. Ships by ${short}.`);
});
