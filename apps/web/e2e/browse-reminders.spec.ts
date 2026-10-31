import { expect, test } from "@playwright/test";

// Browse reminders: the merchant turns them on, a signed-in subscriber looks at a product and
// leaves, and they get one "Still thinking about the …?" email with a link back to it.

test("a subscriber who looked at a product gets one browse reminder", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const email = `look-${id}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`br-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Browse ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Browse/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const storeRoot = lamp.replace(/\/products\/.*$/, "");

  await page.goto("/admin/marketing");
  const section = page.getByRole("region", { name: "Browse reminders" });
  await expect(section.getByRole("button", { name: "Send browse reminders now" })).toHaveCount(0);
  await section.getByLabel("Send browse reminders").check();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("button", { name: "Send browse reminders now" })).toBeVisible();

  // The buyer signs in, says yes to emails, and looks at the lamp.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${storeRoot}/account`);
  await buyer.getByLabel("Email", { exact: true }).fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  const inbox = await buyer.context().newPage();
  // The code can land a moment after the button is pressed.
  const codeMail = inbox.getByRole("article").filter({ hasText: email }).filter({ has: inbox.getByRole("heading", { name: /^\d{6}/ }) }).first();
  await expect(async () => {
    await inbox.goto("/dev/mail");
    await expect(codeMail).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  const subject = await codeMail.getByRole("heading").textContent();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();
  await buyer.getByRole("button", { name: "Send me news and offers" }).click();
  await expect(buyer.getByRole("button", { name: "Send me news and offers" })).toHaveCount(0);
  await buyer.goto(lamp);
  await expect(buyer.getByRole("heading", { level: 1, name: "Sunset Projection Lamp" })).toBeVisible();

  await section.getByRole("button", { name: "Send browse reminders now" }).click();
  await expect(section.getByRole("definition").first()).toHaveText("1");
  await inbox.reload();
  const mail = inbox.getByRole("article").filter({ hasText: email }).filter({ has: inbox.getByRole("heading", { name: "Still thinking about the Sunset Projection Lamp?" }) });
  await expect(mail).toHaveCount(1);
  await expect(mail).toContainText("?utm_source=browse-reminder");
  // Once a week at most.
  await section.getByRole("button", { name: "Send browse reminders now" }).click();
  await inbox.reload();
  await expect(inbox.getByRole("article").filter({ hasText: email }).filter({ has: inbox.getByRole("heading", { name: /Still thinking about/ }) })).toHaveCount(1);
  await buyer.context().close();
});
