import { expect, test, type Page } from "@playwright/test";

// The second checkout reminder: a day after the first, a buyer who still hasn't paid gets a
// one-time code, and its link puts their cart back with the code added, on any device.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a second reminder brings the cart back with a one-time code", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ro-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Comeback ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Comeback/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/marketing");
  const reminders = page.getByRole("region", { name: "Checkout reminders" });
  await reminders.getByLabel("Send a second reminder a day later, with a code").check();
  await reminders.getByLabel("Code gives (% off)").fill("80");
  await reminders.getByRole("button", { name: "Save second reminder" }).click();
  await expect(reminders.getByText("Pick between 5% and 50% off.")).toBeVisible();
  await reminders.getByLabel("Code gives (% off)").fill("15");
  await reminders.getByRole("button", { name: "Save second reminder" }).click();
  await expect(reminders.getByText("Saved. Second reminders give 15% off.")).toBeVisible();
  await shot(page, "440-second-reminder");

  // The buyer leaves at payment.
  const email = `ro-buyer-${id}@example.com`;
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

  await page.reload();
  await reminders.getByRole("button", { name: "Send reminders now" }).click();
  await expect(reminders.getByRole("button", { name: "Send second reminders now" })).toBeVisible();
  await reminders.getByRole("button", { name: "Send second reminders now" }).click();
  await expect(reminders.getByText("Sent, last 30 days").locator("..")).toContainText("2");

  // The email, opened on another device.
  const phone = await (await browser.newContext({ ...info.project.use })).newPage();
  await phone.goto("/dev/mail");
  const mail = phone.getByRole("article").filter({ hasText: email }).filter({ hasText: "15% off what you left" }).first();
  await expect(mail).toContainText("It works once, with this email address");
  const text = (await mail.textContent())!;
  const code = text.match(/BACK-[A-Z2-9]{6}/)![0];
  const link = text.match(/https?:\/\/\S+\/cart\?code=BACK-[A-Z2-9]{6}/)![0];
  await phone.goto(link);
  await expect(phone).toHaveURL(/\/cart$/);
  await expect(phone.getByRole("main")).toContainText("Sunset Projection Lamp");
  await expect(phone.getByRole("main")).toContainText(code);
  await phone.getByRole("link", { name: "Check out" }).click();
  await phone.getByRole("textbox", { name: "Email" }).fill(email);
  await phone.getByLabel("Full name").fill("Ada Lovelace");
  await phone.getByLabel("Address", { exact: true }).fill("1 Main St");
  await phone.getByLabel("City").fill("Austin");
  await phone.getByLabel("State or region").fill("TX");
  await phone.getByLabel("Postal code").fill("78701");
  await phone.getByRole("button", { name: "Continue to payment" }).click();
  await phone.getByRole("button", { name: /^Pay/ }).click();
  await expect(phone.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.reload();
  await expect(reminders.getByText("Then paid").locator("..")).toContainText("1");
});
