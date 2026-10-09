import { expect, test, type Page } from "@playwright/test";

// Payment links: the merchant builds an order for a customer who asked by message or phone, the
// customer gets an email with a link, pays, and it becomes an ordinary paid order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pl-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Direct ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Direct/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
}

test("a merchant emails a payment link and the customer pays it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchantWithLamp(page, id);
  const email = `pl-buyer-${id}@example.com`;
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "Create payment link" }).click();
  await page.getByLabel("Product 1").selectOption({ index: 1 });
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Full name").fill("Grace Hopper");
  await page.getByLabel("Address", { exact: true }).fill("1 Navy Way");
  await page.getByLabel("City").fill("Arlington");
  await page.getByLabel("State or region").fill("VA");
  // A mistake keeps what was typed.
  await page.getByLabel("Discount code (optional)").fill("NOPE");
  await page.getByLabel("Note to the customer (optional)").fill("Two lamps, as we discussed on Instagram.");
  await page.getByLabel("Postal code").fill("22201");
  await page.getByRole("button", { name: "Email the payment link" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /code/i })).toBeVisible();
  await expect(page.getByLabel("Full name")).toHaveValue("Grace Hopper");
  await expect(page.getByLabel("Quantity")).toHaveValue("2");
  await page.getByLabel("Discount code (optional)").fill("");
  await shot(page, "115-payment-link-form");
  await page.getByRole("button", { name: "Email the payment link" }).click();

  await expect(page.getByText(`Payment link emailed to ${email}.`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting for Grace to pay" })).toBeVisible();
  await page.getByRole("button", { name: "Email the link again" }).click();
  await expect(page.getByText("Sent again.")).toBeVisible();
  await shot(page, "116-payment-link-order");

  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = (await inbox.getByRole("article").filter({ hasText: email }).filter({ hasText: "is ready to pay" }).first().textContent())!;
  await inbox.close();
  expect(mail).toContain("Two lamps, as we discussed on Instagram.");
  const url = mail.match(/Pay securely here: (\S+)/)![1]!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(url);
  await expect(buyer.getByText(/put together this order for Grace/)).toBeVisible();
  await expect(buyer.getByText("Two lamps, as we discussed on Instagram.")).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Waiting for Grace to pay" })).toHaveCount(0);
  await expect(page.getByText("Payment link", { exact: true }).first()).toBeVisible();
});
