import { expect, test, type Page } from "@playwright/test";

// Welcome offer: the merchant turns it on, the signup form shows it, and a confirmed subscriber
// gets a code of their own by email that takes the percentage off their first order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a new subscriber gets a personal code and uses it on their first order", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`wel-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Hello ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Hello/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const store = lamp.replace(/\/products\/.*$/, "");

  // A theme with an email signup section on the home page.
  await page.goto("/admin/theme");
  await page.getByRole("tab", { name: "Themes" }).click();
  await page.getByLabel("Also replace my home page sections").check();
  await page.getByRole("button", { name: "Use Boutique" }).click();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await page.goto("/admin/marketing");
  const offer = page.getByRole("region", { name: "Welcome offer" });
  await offer.getByLabel("Email new signups a personal code").check();
  await offer.getByLabel("Percent off").fill("60");
  await offer.getByRole("button", { name: "Save welcome offer" }).click();
  await expect(offer.getByText("The welcome offer is 5% to 50% off.")).toBeVisible();
  await expect(offer.getByLabel("Days to use it")).toHaveValue("30");
  await offer.getByLabel("Percent off").fill("15");
  await offer.getByLabel("Days to use it").fill("14");
  await offer.getByRole("button", { name: "Save welcome offer" }).click();
  await expect(offer.getByRole("status")).toHaveText("Saved. New signups get a code from now on.");
  await shot(page, "151-welcome-offer");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByText("Sign up and get 15% off your first order.")).toBeVisible();
  const email = `new-fan-${id}@example.com`;
  await buyer.getByLabel("Email for news and offers").fill(email);
  await buyer.getByRole("button", { name: "Sign up" }).click();
  await expect(buyer.getByRole("status")).toContainText("Check your inbox");

  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const confirm = (await inbox.getByRole("article").filter({ hasText: email }).filter({ hasText: "Confirm your signup" }).textContent())!;
  await buyer.goto(confirm.match(/https?:\/\/\S+?\/subscribe\/[0-9a-f]{64}/)![0]);
  await buyer.getByRole("button", { name: "Confirm" }).click();
  await expect(buyer.getByRole("heading", { name: "You're signed up" })).toBeVisible();
  await expect(buyer.getByText("We've emailed you a code for 15% off your first order.")).toBeVisible();

  await inbox.reload();
  const mail = inbox.getByRole("article").filter({ hasText: email }).filter({ hasText: "Your 15% off code" });
  const code = (await mail.textContent())!.match(/WELCOME-[A-Z0-9]{6}/)![0];

  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByLabel("Discount or gift card code").fill(code.toLowerCase());
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText(`Discount (${code})`)).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(email);
  await buyer.getByLabel("Full name").fill("Lin Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText(`Discount (${code})`)).toBeVisible();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Lin!" })).toBeVisible();

  // The merchant sees it worked; the personal code isn't on the codes list.
  await page.reload();
  await expect(offer.getByText("Codes sent").locator("..")).toContainText("1");
  await expect(offer.getByText("Used", { exact: true }).locator("..")).toContainText("1");
  await expect(page.getByText(code)).toHaveCount(0);
});
