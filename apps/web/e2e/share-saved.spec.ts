import { expect, test, type Page } from "@playwright/test";

// Sharing a saved list: a signed-in buyer gets a link to what they saved, a friend opens it (no
// email or saved prices shown), and stopping sharing turns the link off.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer shares their saved list with a friend, then stops", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`share-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Wishes ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Wishes/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const storeLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // The buyer saves the lamp and signs in on the Saved page.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const email = `wisher-${id}@example.com`;
  await buyer.goto(storeLink);
  await buyer.getByRole("button", { name: "Save for later" }).click();
  await expect(buyer.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await buyer.getByRole("link", { name: "See your saved items" }).click();
  await expect(buyer.getByRole("link", { name: "Sunset Projection Lamp" })).toBeVisible();
  // Guests can't share: the list lives in their browser.
  await expect(buyer.getByRole("button", { name: "Get a link to share" })).toHaveCount(0);
  await buyer.getByLabel("Email", { exact: true }).fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const subject = await inbox.getByRole("article").filter({ hasText: email }).first().getByRole("heading").textContent();
  await inbox.close();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();
  await expect(buyer.getByText(`We email ${email} when something you saved gets cheaper.`)).toBeVisible();

  // They get a link to share.
  await buyer.getByRole("button", { name: "Get a link to share" }).click();
  const card = buyer.getByRole("region", { name: "Share your list" });
  const linkBox = card.getByLabel("Your link");
  await expect(linkBox).toHaveValue(/\/saved\/[\w-]{24}$/);
  const link = await linkBox.inputValue();
  await shot(buyer, "411-share-saved");

  // A friend opens it: the lamp is there, the buyer's email isn't.
  const friend = await (await browser.newContext({ ...info.project.use })).newPage();
  await friend.goto(link);
  await expect(friend.getByRole("heading", { name: "Saved items", level: 1 })).toBeVisible();
  await expect(friend.getByText("Buying a gift?")).toBeVisible();
  await expect(friend.getByRole("link", { name: "Sunset Projection Lamp" })).toBeVisible();
  await expect(friend.getByText(email)).toHaveCount(0);
  await expect(friend.getByRole("button", { name: /Remove/ })).toHaveCount(0);
  await shot(friend, "412-shared-saved-list");
  await friend.getByRole("link", { name: "Sunset Projection Lamp" }).click();
  await expect(friend.getByRole("heading", { name: "Sunset Projection Lamp", level: 1 })).toBeVisible();

  // Stopping turns the link off; sharing again makes a new one.
  await card.getByRole("button", { name: "Stop sharing" }).click();
  await expect(buyer.getByRole("button", { name: "Get a link to share" })).toBeVisible();
  expect((await friend.goto(link))?.status()).toBe(404);
  await buyer.getByRole("button", { name: "Get a link to share" }).click();
  await expect(card.getByLabel("Your link")).not.toHaveValue(link);
});
