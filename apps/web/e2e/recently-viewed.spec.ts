import { expect, test, type Page } from "@playwright/test";

// Recently viewed: products a shopper opened show up again on other product pages and in the
// cart, newest first, remembered on their device only.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("products a shopper looked at come back on product pages and in the cart", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Looks ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Looks/ })).toBeVisible();
  const links: string[] = [];
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    links.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  }
  const [lamp, stand] = links as [string, string];

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const recent = buyer.getByRole("region", { name: "Recently viewed" });
  await buyer.goto(lamp);
  const lampTitle = (await buyer.getByRole("heading", { level: 1 }).textContent())!.trim();
  // Nothing viewed before this one.
  await expect(recent).toHaveCount(0);
  await buyer.goto(stand);
  const standTitle = (await buyer.getByRole("heading", { level: 1 }).textContent())!.trim();
  await expect(recent.getByRole("link")).toHaveCount(1);
  await expect(recent.getByRole("link")).toContainText(lampTitle);
  await shot(buyer, "154-recently-viewed");

  // Back on the lamp, the stand shows, and never the page's own product.
  await recent.getByRole("link", { name: new RegExp(lampTitle) }).click();
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(lampTitle);
  await expect(recent.getByRole("link")).toHaveCount(1);
  await expect(recent.getByRole("link")).toContainText(standTitle);

  // In the cart, what's already in it is left out.
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(recent.getByRole("link")).toHaveCount(1);
  await expect(recent.getByRole("link")).toContainText(standTitle);

  // Another shopper starts with nothing.
  const other = await (await browser.newContext({ ...info.project.use })).newPage();
  await other.goto(stand);
  await expect(other.getByRole("region", { name: "Recently viewed" })).toHaveCount(0);
});
