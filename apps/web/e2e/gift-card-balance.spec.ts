import { expect, test } from "@playwright/test";

// Gift card balance: whoever has the code can see what's left on it, from the link in the gift card email.

test("a gift card's balance can be checked with its code", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`gcb-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Balance ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Balance/ })).toBeVisible();

  const email = `friend-${id}@example.com`;
  await page.goto("/admin/gift-cards");
  await page.getByLabel("Send to").fill(email);
  await page.getByLabel("Amount", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Send gift card" }).click();
  await expect(page.getByText("Gift card sent.")).toBeVisible();
  await page.goto("/dev/mail");
  const mail = (await page.getByRole("article").filter({ hasText: email }).filter({ hasText: "Your $25.00 gift card for" }).first().textContent())!;
  const code = mail.match(/Gift card code: ([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/)![1]!;
  const link = mail.match(/Check what's left on it: (\S+\/gift-cards)/)![1]!;

  const friend = await (await browser.newContext({ ...info.project.use })).newPage();
  await friend.goto(link);
  await expect(friend.getByRole("heading", { name: "Gift card balance" })).toBeVisible();
  await friend.getByLabel("Gift card code").fill("AAAA-BBBB-CCCC-DDDD");
  await friend.getByRole("button", { name: "Check balance" }).click();
  await expect(friend.getByRole("main").getByText("That code doesn't match a gift card here. Check it against your email.")).toBeVisible();
  await friend.getByLabel("Gift card code").fill(code.toLowerCase());
  await friend.getByRole("button", { name: "Check balance" }).click();
  await expect(friend.getByRole("main").getByRole("status")).toHaveText(`Gift card ···· ${code.slice(-4)}: $25.00 left of $25.00`);
});
