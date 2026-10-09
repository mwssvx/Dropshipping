import { expect, test, type Page } from "@playwright/test";

// Saved items: a buyer saves a product as a guest, signs in to keep it, and gets one email when
// the merchant lowers the price.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer saves a product, signs in to keep it, and hears when the price drops", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Saver ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Saver/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const productUrl = page.url().replace(/\?.*$/, "");
  const storeLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // A guest saves it.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const email = `saver-${id}@example.com`;
  await buyer.goto(storeLink);
  await buyer.getByRole("button", { name: "Save for later" }).click();
  await expect(buyer.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "Saved", pressed: true })).toBeVisible();

  // They sign in from the Saved page to keep it and hear about price drops.
  await buyer.getByRole("link", { name: "See your saved items" }).click();
  await expect(buyer.getByRole("link", { name: "Sunset Projection Lamp" })).toBeVisible();
  await buyer.getByLabel("Email", { exact: true }).fill(email);
  await buyer.getByRole("button", { name: "Email me a code" }).click();
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const subject = await inbox.getByRole("article").filter({ hasText: email }).first().getByRole("heading").textContent();
  await inbox.close();
  await buyer.getByLabel("Code").fill(subject!.match(/^(\d{6})/)![1]!);
  await buyer.getByRole("button", { name: "Sign in" }).click();
  await expect(buyer.getByText(`We email ${email} when something you saved gets cheaper.`)).toBeVisible();
  await expect(buyer.getByRole("link", { name: "Sunset Projection Lamp" })).toBeVisible();

  // The merchant sees it was saved, and lowers the price.
  await page.goto(productUrl);
  await expect(page.getByText("1 buyer saved this for later.")).toBeVisible();
  await page.locator("#price-0").fill("9.99");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const mailPage = await page.context().newPage();
  await mailPage.goto("/dev/mail");
  const mail = mailPage.getByRole("article").filter({ hasText: email }).filter({ hasText: "Price drop" });
  await expect(mail).toContainText("Price drop: Sunset Projection Lamp");
  await expect(mail).toContainText("$9.99 (was $13.99)");
  await mailPage.close();

  await buyer.reload();
  await expect(buyer.getByText("Price dropped")).toBeVisible();
  await shot(buyer, "125-saved-items");
  await buyer.getByRole("button", { name: "Remove Sunset Projection Lamp" }).click();
  await expect(buyer.getByText("Nothing saved yet.", { exact: false })).toBeVisible();
});
