import { expect, test, type Page } from "@playwright/test";

// Sales: the merchant puts the lamp on sale until a date, a buyer sees the old price crossed out
// and pays the sale price, and when the merchant ends it the price goes back.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant runs a sale and ends it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sale-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bargains ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bargains/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // 25% off the lamp, starting now, until June 1.
  await page.goto("/admin/sales");
  await page.getByLabel("Name").fill("Spring sale");
  await page.getByLabel("Discount (%)").fill("25");
  await page.getByLabel("What's on sale").selectOption("products");
  await page.getByRole("checkbox", { name: /Sunset Projection Lamp/ }).check();
  await page.getByLabel("Ends").fill("2030-06-01T12:00");
  await page.getByRole("button", { name: "Add sale" }).click();
  await expect(page.getByText("Sale added. It's on the store now.")).toBeVisible();
  const spring = page.getByRole("listitem", { name: "Spring sale" });
  await expect(spring).toContainText("On now");
  await expect(spring).toContainText("1 product");

  // A sale on everything, later on.
  await page.getByLabel("Name").fill("Summer sale");
  await page.getByLabel("Discount (%)").fill("10");
  await page.getByLabel("Starts").fill("2030-07-01T09:00");
  await page.getByRole("button", { name: "Add sale" }).click();
  await expect(page.getByText("Sale scheduled. It starts by itself.")).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Summer sale" })).toContainText("Scheduled");
  await shot(page, "138-sales");

  // The buyer sees the old price crossed out and pays the sale price.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await expect(buyer.getByText("On sale: 25% off until June 1.")).toBeVisible();
  await expect(buyer.locator("s", { hasText: "$13.99" }).first()).toBeVisible();
  await expect(buyer.getByText("$10.49").first()).toBeVisible();
  await shot(buyer, "139-sale-on-product");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.getByText("Spring sale: 25% off")).toBeVisible();
  await expect(buyer.getByText("$10.49").first()).toBeVisible();
  await shot(buyer, "140-sale-in-cart");

  // Ended: the price goes back.
  await spring.getByRole("button", { name: "End now" }).click();
  await expect(spring).toContainText("Ended");
  await buyer.goto(lamp);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByText(/On sale:/)).toHaveCount(0);
  await expect(buyer.getByText("$13.99").first()).toBeVisible();
});
