import { expect, test } from "@playwright/test";

// Refer a friend: a buyer shares the link from their order page, and a friend gets a code by email.

test("a buyer shares their link and a friend gets a first-order code by email", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ref-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Friends ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Friends/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/marketing");
  const refer = page.getByRole("region", { name: "Refer a friend" });
  await refer.getByLabel("Let buyers refer friends").check();
  await refer.getByLabel("Friend's percent off").fill("60");
  await refer.getByRole("button", { name: "Save refer a friend" }).click();
  await expect(refer.getByRole("alert")).toContainText("5% to 50%");
  await expect(refer.getByLabel("Credit for the buyer ($)")).toHaveValue("10.00");
  await refer.getByLabel("Friend's percent off").fill("15");
  await refer.getByRole("button", { name: "Save refer a friend" }).click();
  await expect(refer.getByRole("status")).toContainText("Buyers see their link");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const card = buyer.getByRole("region", { name: "Give friends 15% off" });
  await expect(card).toContainText("you get $10.00 in store credit when it arrives");
  const link = await card.getByLabel("Your link").inputValue();
  expect(link).toMatch(/\/refer\/[A-Z2-9]{8}$/);

  const friend = await (await browser.newContext({ ...info.project.use })).newPage();
  await friend.goto(link);
  await expect(friend.getByRole("heading", { name: "Ada gave you 15% off" })).toBeVisible();
  await friend.getByLabel("Email").fill(`grace-${id}@example.com`);
  await friend.getByRole("button", { name: "Email me my code" }).click();
  await expect(friend.getByRole("status")).toContainText(`your code is on its way to grace-${id}@example.com`);

  const inbox = await friend.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: `grace-${id}@example.com` }).filter({ hasText: "Ada gave you 15% off" });
  await expect(mail).toHaveCount(1);
  await expect(mail).toContainText(/FRIEND-[A-Z2-9]{6}/);

  await page.goto("/admin/marketing");
  await expect(page.getByRole("region", { name: "Refer a friend" }).getByText("Friends sent a code").locator("..")).toContainText("1");
});
