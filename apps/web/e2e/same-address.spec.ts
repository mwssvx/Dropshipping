import { expect, test, type Page } from "@playwright/test";

// A buyer who comes back for one more thing: the admin order page lists their other order to the
// same door, so the store's own items can go in one box.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the merchant sees two orders going to the same address", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sa-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Same door ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Same door/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Beeswax Candle");
  await page.getByLabel("Price", { exact: true }).fill("12.00");
  await page.getByLabel("Stock", { exact: true }).fill("6");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const candle = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const buy = async (street: string) => {
    await buyer.goto(candle);
    await buyer.getByRole("button", { name: "Add to cart" }).click();
    await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
    await buyer.goto(candle.replace(/\/products\/.*$/, "/cart"));
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
    await buyer.getByLabel("Full name").fill("Ada Lovelace");
    await buyer.getByLabel("Address", { exact: true }).fill(street);
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
    await buyer.getByRole("button", { name: /^Pay / }).click();
    await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  };
  await buy("1 Main St");
  await buy("1 main st.");

  // The order list marks both, each pointing at the other.
  await page.goto("/admin/orders");
  await expect(page.getByText("Same address as #1001")).toBeVisible();
  await expect(page.getByText("Same address as #1002")).toBeVisible();
  await shot(page, "325-list-same-address");
  await page.getByRole("link", { name: "#1002" }).first().click();
  await page.waitForURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
  const same = page.getByRole("region", { name: "Also going to this address" });
  await expect(same.getByRole("link", { name: "Order #1001" })).toBeVisible();
  await expect(same).toContainText("has items you post");
  await expect(same).toContainText("can go in one box");
  await shot(page, "323-same-address");

  // Once this one is posted, the other order no longer lists it.
  await page.getByRole("button", { name: "Add tracking yourself" }).first().click();
  await page.getByLabel("Carrier").fill("USPS");
  await page.getByLabel("Tracking number").fill("9400111899");
  await page.getByRole("button", { name: "Mark as shipped" }).click();
  await expect(page.getByText("9400111899", { exact: true }).or(page.getByRole("link", { name: "9400111899" })).first()).toBeVisible();
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await page.waitForURL(/\/admin\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Also going to this address" })).toHaveCount(0);
});
