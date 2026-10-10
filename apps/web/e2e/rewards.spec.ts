import { expect, test, type Page } from "@playwright/test";

// Rewards: the merchant turns on points, a buyer earns them on an order, the merchant adds a few
// more by hand, and the buyer swaps them for store credit that's waiting in their cart.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer earns points on an order and swaps them for store credit", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const email = `points-${id}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rw-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Loyal ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Loyal/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const storeRoot = lamp.replace(/\/products\/.*$/, "");

  // 10 points per $1, and 100 points are worth $1.
  await page.goto("/admin/rewards");
  await page.getByLabel("Give buyers points on their orders").check();
  await page.getByLabel("Points per 1.00 spent").fill("10");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Rewards settings saved.")).toBeVisible();
  await expect(page.getByText("Buyers see: 10 points per $1.00 spent. 100 points = $1.00 off.")).toBeVisible();

  // The buyer sees what they'll earn, and pays.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByText("You'll earn 139 points with this order.")).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // The merchant adds 400 points for a late parcel.
  await page.goto("/admin/customers");
  await page.getByRole("link", { name: /Ada Lovelace/ }).first().click();
  const card = page.getByRole("region", { name: "Rewards" });
  await expect(card).toContainText("139 points");
  await card.getByLabel("Points").fill("400");
  await card.getByLabel("Note for them").fill("Sorry the parcel was late");
  await card.getByRole("button", { name: "Save points" }).click();
  await expect(card.getByText("Saved. They have 539 points now.")).toBeVisible();

  // The buyer signs in and swaps 500 points for $5.00 of store credit.
  await buyer.goto(`${storeRoot}/account`);
  await buyer.getByLabel("Email", { exact: true }).fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const subject = await inbox.getByRole("article").filter({ hasText: email }).filter({ has: inbox.getByRole("heading", { name: /^\d{6}/ }) }).first().getByRole("heading").textContent();
  await inbox.close();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();
  const points = buyer.getByRole("region", { name: "Your points" });
  await expect(points).toContainText("539");
  await expect(points).toContainText("Worth $5.00 in store credit.");
  await expect(points).toContainText("Sorry the parcel was late");
  await expect(points.getByLabel("Points to use")).toHaveValue("500");
  await shot(buyer, "132-points-on-account");
  await points.getByRole("button", { name: "Swap for store credit" }).click();
  await expect(points.getByText("$5.00 of store credit is in your cart. We emailed you the code too.")).toBeVisible();
  await expect(points).toContainText("39");

  // It's waiting in the cart.
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.getByText(/Gift card ····/).first()).toBeVisible();
  await expect(buyer.getByText("$0.00 stays on the card after this order.")).toBeVisible();
  await shot(buyer, "133-credit-in-cart");
  await page.goto("/admin/rewards");
  await shot(page, "134-rewards-admin");
  await expect(page.getByText("Points swapped so far")).toBeVisible();
});
