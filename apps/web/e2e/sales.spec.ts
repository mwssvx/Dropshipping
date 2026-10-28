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
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`sale-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // Ended: the price goes back.
  await spring.getByRole("button", { name: "End now" }).click();
  await expect(spring).toContainText("Ended");
  // What it sold.
  await expect(spring.getByLabel("Results of Spring sale")).toHaveText("Over 1 day: 1 order, 1 item on sale, $10.49");
  await buyer.goto(lamp);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByText(/On sale:/)).toHaveCount(0);
  await expect(buyer.getByText("$13.99").first()).toBeVisible();

  // Early access to the summer sale: a code with its 10% off until it starts, sent as a link.
  const summer = page.getByRole("listitem", { name: "Summer sale" });
  await summer.getByLabel("Early access starts").selectOption("24");
  await summer.getByRole("button", { name: "Give early access" }).click();
  const early = summer.getByLabel("Early access to Summer sale");
  await expect(early).toContainText("Early access with the code EARLY-SUMMERSALE, from Jun 30");
  await expect(early).toContainText("for anyone with the link");
  const link = await early.getByLabel("Link to send (applies the code)").inputValue();
  expect(link).toMatch(/\/discount\/EARLY-SUMMERSALE$/);
  await shot(page, "216-early-access");
  await early.getByRole("button", { name: "Stop early access" }).click();
  await expect(summer.getByRole("button", { name: "Give early access" })).toBeVisible();
  // Starting now this time: the buyer follows the link and the cart takes the code.
  await summer.getByRole("button", { name: "Give early access" }).click();
  await expect(summer).toContainText("EARLY-SUMMERSALE2 until the sale starts");
  await expect(summer.getByLabel("Link to send (applies the code)")).toHaveValue(/\/discount\/EARLY-SUMMERSALE2$/);
  // (The link uses the store's own address; the tests reach the store through the platform's.)
  await buyer.goto(`${lamp.split("/products/")[0]}/discount/EARLY-SUMMERSALE2`);
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.getByText("EARLY-SUMMERSALE2").first()).toBeVisible();
});
