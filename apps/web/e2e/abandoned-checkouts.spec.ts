import { expect, test, type Page } from "@playwright/test";

// Abandoned checkouts: buyers who left at payment, whether they were reminded, and who came back.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the merchant sees checkouts buyers left and whether the reminder went out", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ab-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Leftover ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Leftover/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "Abandoned checkouts" }).click();
  await expect(page.getByRole("heading", { name: "Abandoned checkouts" })).toBeVisible();
  await expect(page.getByText("No abandoned checkouts.")).toBeVisible();

  // The buyer leaves at payment.
  const email = `ab-buyer-${id}@example.com`;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByRole("button", { name: /^Pay/ })).toBeVisible();
  await buyer.context().close();

  // Inside the hour nothing shows; once the reminder goes out, it does.
  await page.reload();
  await expect(page.getByText("No abandoned checkouts.")).toBeVisible();
  await page.goto("/admin/marketing");
  const reminders = page.getByRole("region", { name: "Checkout reminders" });
  await reminders.getByRole("button", { name: "Send reminders now" }).click();
  await expect(reminders.getByText("Sent, last 30 days").locator("..")).toContainText("1");

  await page.goto("/admin/orders/abandoned");
  const row = page.getByRole("row", { name: new RegExp(email) });
  await expect(row).toContainText("Ada Lovelace");
  await expect(row).toContainText("Sent");
  await expect(row).toContainText("Not yet");
  await expect(page.getByText("Left unpaid").locator("..")).toContainText("1");
  await expect(page.getByText("Came back and paid").locator("..")).toContainText("0");
  await shot(page, "450-abandoned-checkouts");

  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/admin\/orders\/[0-9a-f-]+$/);
});
