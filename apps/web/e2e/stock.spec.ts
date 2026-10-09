import { expect, test, type Page } from "@playwright/test";

// Back in stock: a buyer leaves their email on a sold-out option, and gets one email when the
// supplier has it again.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer asks to hear when a sold-out option is back, and is emailed once it is", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`st-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Restock ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Restock/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const productUrl = page.url().replace(/\?.*$/, "");
  const storeLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // The merchant marks the Small option sold out by hand.
  await expect(page.locator("#stock-0")).toHaveValue(/^\d+$/);
  await page.locator("#stock-0").fill("0");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.locator("#stock-0")).toHaveValue("0");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const email = `waiting-${id}@example.com`;
  await buyer.goto(storeLink);
  await expect(buyer.getByRole("heading", { name: "Option sold out? Email me when it's back" })).toBeVisible();
  const form = buyer.locator("#stock-alert");
  await form.getByLabel("Email").fill(email);
  await expect(form.getByLabel("Option")).toHaveValue(/.+/);
  await form.getByRole("button", { name: "Notify me" }).click();
  await expect(buyer.getByText("Done. We'll email you once when it's back.")).toBeVisible();
  await shot(buyer, "120-stock-alert");

  // The merchant sees who's waiting and checks the supplier, who still has it.
  await page.goto(productUrl);
  await expect(page.getByText("1 buyer is waiting for Small to come back.")).toBeVisible();
  await shot(page, "121-stock-waiting");
  await page.getByRole("button", { name: "Check supplier now" }).click();
  await expect(page.getByRole("status").filter({ hasText: "in stock" })).toContainText("1 buyer who was waiting got a back-in-stock email.");
  await page.reload();
  await expect(page.getByText(/buyers? (is|are) waiting/)).toHaveCount(0);

  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: email });
  await expect(mail).toContainText("Back in stock: Sunset Projection Lamp");
  await expect(mail).toContainText("Sunset Projection Lamp (Small) is back in stock");
  await inbox.close();

  // Now it's back, the store doesn't offer the form.
  await buyer.goto(storeLink);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.locator("#stock-alert")).toHaveCount(0);
});
