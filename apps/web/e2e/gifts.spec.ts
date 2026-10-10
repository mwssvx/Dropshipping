import { expect, test, type Page } from "@playwright/test";

// Gift orders: the buyer marks the order as a gift with a message; the recipient hears when it
// ships, with the message and tracking but no prices.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function reloadUntil(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 20_000 });
}

test("a buyer sends a gift and the recipient hears when it ships", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`gift-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Presents ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Presents/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyerEmail = `ada-${id}@example.com`;
  const recipient = `grace-${id}@example.com`;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(buyerEmail);
  await buyer.getByLabel("Full name").fill("Grace Hopper");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await expect(buyer.getByLabel("From (your name)")).toHaveCount(0);
  await buyer.getByLabel("This order is a gift").check();
  await buyer.getByLabel("From (your name)").fill("Ada Lovelace");
  await buyer.getByLabel("Gift message (optional)").fill("Happy birthday, Grace!");
  await buyer.getByLabel("Recipient's email (optional)").fill(recipient);
  await shot(buyer, "149-gift-at-checkout");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const gift = buyer.getByRole("region", { name: "A gift for Grace Hopper" });
  await expect(gift).toContainText("Happy birthday, Grace!");
  await expect(gift).toContainText(`We'll email ${recipient} when it ships`);
  const statusUrl = buyer.url();

  // The merchant sees it's a gift; tracking comes in and the recipient is told.
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(page.getByRole("region", { name: /Gift/ })).toContainText("From Ada Lovelace to Grace Hopper");
  await reloadUntil(page, () => expect(page.getByRole("button", { name: "Check for tracking now" })).toBeVisible({ timeout: 1000 }));
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText(`Gift heads-up email sent to ${recipient}`)).toBeVisible();
  await shot(page, "150-gift-order-admin");

  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: recipient }).first();
  await expect(mail.getByRole("heading")).toHaveText(/Ada Lovelace sent you a gift from Presents/);
  await expect(mail).toContainText("Happy birthday, Grace!");
  await expect(mail).toContainText("Track it:");
  await expect(mail).not.toContainText("$");
  await buyer.goto(statusUrl);
  await expect(buyer.getByRole("heading", { name: "Tracking" })).toBeVisible();
});
