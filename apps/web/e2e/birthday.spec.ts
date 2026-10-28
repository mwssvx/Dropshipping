import { expect, test } from "@playwright/test";

// Birthday codes: the merchant turns them on, a buyer adds their birthday on their store account,
// and the merchant sees it on the customer's page.

test("a buyer adds their birthday for the store's birthday code", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const email = `bday-${id}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bd-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Party ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Party/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const storeRoot = lamp.replace(/\/products\/.*$/, "");

  await page.goto("/admin/marketing");
  const section = page.getByRole("region", { name: "Birthday codes" });
  await section.getByLabel("Email subscribers a code on their birthday").check();
  await section.getByLabel("Birthday percent off").fill("20");
  await section.getByRole("button", { name: "Save birthday codes" }).click();
  await expect(section.getByText("Saved. Codes go out with the daily emails.")).toBeVisible();
  await expect(section.getByText("No subscriber has added their birthday yet.")).toBeVisible();

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
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await buyer.goto(`${storeRoot}/account`);
  await buyer.getByLabel("Email", { exact: true }).fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const subject = await inbox.getByRole("article").filter({ hasText: email }).filter({ has: inbox.getByRole("heading", { name: /^\d{6}/ }) }).first().getByRole("heading").textContent();
  await inbox.close();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();

  const card = buyer.getByRole("region", { name: "Your birthday" });
  await expect(card).toContainText("we'll email you 20% off that day, once you say yes to news and offers.");
  // A day the month doesn't have.
  await card.getByLabel("Month").selectOption({ label: "February" });
  await card.getByLabel("Day").selectOption("30");
  await card.getByRole("button", { name: "Save birthday" }).click();
  await expect(card.getByText("Pick the month and the day of your birthday.")).toBeVisible();
  await card.getByLabel("Month").selectOption({ label: "July" });
  await card.getByLabel("Day").selectOption("4");
  await card.getByRole("button", { name: "Save birthday" }).click();
  await expect(card).toContainText("We have July 4.");
  await buyer.getByRole("button", { name: "Send me news and offers" }).click();
  await expect(buyer.getByRole("region", { name: "Your birthday" })).toContainText("we'll email you 20% off that day. We only ask");
  await buyer.context().close();

  await page.goto("/admin/customers");
  await page.getByRole("link", { name: /Ada Lovelace/ }).first().click();
  await expect(page.getByText("Birthday: July 4")).toBeVisible();
  await page.goto("/admin/marketing");
  await expect(page.getByText("1 subscriber has added their birthday.")).toBeVisible();
});
