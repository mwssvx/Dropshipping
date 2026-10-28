import { expect, test } from "@playwright/test";

// Chat buttons: the store's WhatsApp and Telegram, one tap away, with the page the shopper was on
// in the first WhatsApp message. They stay off the checkout.

test("shoppers can message the store on WhatsApp or Telegram", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`chat-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Chatty ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Chatty/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/inbox");
  await page.getByLabel("WhatsApp number").fill("07700 900123");
  await page.getByRole("button", { name: "Save chat buttons" }).click();
  await expect(page.getByText("with its country code")).toBeVisible();
  await page.getByLabel("WhatsApp number").fill("+44 7700 900123");
  await page.getByLabel("Telegram username").fill("@glowlamps");
  await page.getByRole("button", { name: "Save chat buttons" }).click();
  await expect(page.getByRole("region", { name: "Chat buttons" }).getByRole("status")).toHaveText("Saved.");

  const context = await browser.newContext({ ...info.project.use });
  // The apps themselves aren't reachable from the tests: answer for them.
  await context.route(/https:\/\/(wa\.me|t\.me)\//, (r) => r.fulfill({ body: "chat", contentType: "text/plain" }));
  const buyer = await context.newPage();
  await buyer.goto(lamp);
  await expect(buyer.getByRole("link", { name: "Chat on Telegram" })).toHaveAttribute("href", "https://t.me/glowlamps");
  const opened = context.waitForEvent("page");
  await buyer.getByRole("link", { name: "Chat on WhatsApp" }).click();
  const chat = await opened;
  await chat.waitForLoadState();
  const url = new URL(chat.url());
  expect(url.origin + url.pathname).toBe("https://wa.me/447700900123");
  expect(url.searchParams.get("text")).toBe(`Hi! I have a question about this: ${buyer.url()}`);
  await chat.close();

  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(buyer.getByRole("link", { name: "Chat on WhatsApp" })).toHaveCount(0);
  await context.close();
});
