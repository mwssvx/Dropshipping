import { expect, test, type Page } from "@playwright/test";

// Email campaigns: buyers opt in at checkout, the merchant writes and sends a campaign, a click
// and the order after it are counted, and the unsubscribe link works without signing in.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithLamp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cmp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lumen ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lumen/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
}

async function buy(page: Page, productUrl: string, email: string, name: string, optIn: boolean) {
  await page.goto(productUrl);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Check out" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  if (optIn) await page.getByLabel("Send me news and offers").check();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or region").fill("TX");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
}

/** The development outbox stands in for the buyer's inbox. */
async function campaignEmail(page: Page, to: string, subject: string) {
  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: to }).filter({ hasText: subject }).first();
  await expect(mail).toBeVisible();
  const text = (await mail.textContent())!;
  await inbox.close();
  // Store links are on the store's own address.
  const link = (re: RegExp) => text.match(re)![0];
  return { text, click: link(/https?:\/\/\S+?\/r\/[0-9a-f-]{36}/), unsubscribe: link(/https?:\/\/\S+?\/unsubscribe\/[0-9a-f]{64}/) };
}

test("buyers opt in, the merchant sends a campaign, and the click and sale are counted", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const product = await newMerchantWithLamp(page, id);
  const ada = await (await browser.newContext({ ...info.project.use })).newPage();
  const adaEmail = `cmp-ada-${id}@example.com`;
  await buy(ada, product, adaEmail, "Ada Lovelace", true);
  const grace = await (await browser.newContext({ ...info.project.use })).newPage();
  await buy(grace, product, `cmp-grace-${id}@example.com`, "Grace Hopper", false);

  await page.goto("/admin/marketing");
  await page.getByRole("link", { name: "Open campaigns" }).click();
  await expect(page.getByRole("heading", { name: "Email campaigns", exact: true })).toBeVisible();
  await expect(page.getByText("Subscribers", { exact: true }).locator("..")).toContainText("1");
  await page.getByRole("textbox", { name: "Mailing address" }).fill("Lumen Goods\n12 Elm St\nAustin TX 78701");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Address saved.")).toBeVisible();

  await page.getByRole("link", { name: "New campaign" }).click();
  const subject = `New lamps are in ${id}`;
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Email", { exact: true }).fill("Hi {first_name},\n\nThe new sunset lamps just arrived. Take 10% off this week.");
  await page.getByLabel("Link text (optional)").fill("See the lamps");
  await page.getByLabel("Goes to").fill("/");
  await expect(page.getByLabel("Send to")).toContainText("Everyone who said yes to emails (1)");
  await page.getByRole("button", { name: "Save and preview" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview).toContainText("Hi Ada,");
  await expect(preview).toContainText("Lumen Goods, 12 Elm St, Austin TX 78701");
  await page.getByRole("button", { name: "Send test" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Test sent to" })).toBeVisible();
  await shot(page, "94-campaign-draft");

  await page.getByRole("button", { name: "Send to 1 person" }).click();
  await expect(page.getByRole("heading", { name: /^(Sent|Sending now)/ })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: /^Sent / })).toBeVisible({ timeout: 1000 });
  }).toPass();

  // Ada gets it with her name; Grace, who didn't tick the box, doesn't.
  const mail = await campaignEmail(ada, adaEmail, subject);
  expect(mail.text).toContain("Hi Ada,");
  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  await expect(inbox.getByRole("article").filter({ hasText: `cmp-grace-${id}` }).filter({ hasText: subject })).toHaveCount(0);
  await inbox.close();

  // Ada clicks through and buys again: the campaign gets the credit.
  await ada.goto(mail.click);
  await expect(ada).toHaveURL(/^http:\/\/lumen-[^/]+\/$/);
  // The email links to the store's own address, so she keeps shopping there.
  await buy(ada, new URL(product.replace(/^\/s\/[^/]+/, ""), ada.url()).href, adaEmail, "Ada Lovelace", false);
  await page.reload();
  const results = page.getByRole("region", { name: /^Sent / });
  await expect(results.getByText("Clicked", { exact: true }).locator("..")).toContainText("1");
  await expect(results.getByText("Orders", { exact: true }).locator("..")).toContainText("1");
  await shot(page, "95-campaign-results");

  // The unsubscribe link works without signing in, and mail apps' one-click button too.
  const stranger = await (await browser.newContext({ ...info.project.use })).newPage();
  await stranger.goto(mail.unsubscribe);
  await expect(stranger.getByRole("heading", { name: /^Unsubscribe from Lumen/ })).toBeVisible();
  await stranger.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(stranger.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
  await shot(stranger, "96-unsubscribed");
  // Sent from the page because only the browser resolves store subdomains of localhost.
  const oneClick = await stranger.evaluate((url) => fetch(url, { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) }).then((r) => r.status), `${mail.unsubscribe}/one-click`);
  expect(oneClick).toBe(204);
  await page.goto("/admin/campaigns");
  await expect(page.getByText("Subscribers", { exact: true }).locator("..")).toContainText("0");
});

test("a campaign can't go out without a mailing address, and can be scheduled and cancelled", async ({ page, browser }, info) => {
  const id = `${info.project.name}-sched-${Date.now()}`;
  const product = await newMerchantWithLamp(page, id);
  const ada = await (await browser.newContext({ ...info.project.use })).newPage();
  await buy(ada, product, `cmp-ada2-${id}@example.com`, "Ada Lovelace", true);

  await page.goto("/admin/campaigns/new");
  await page.getByLabel("Subject").fill("Weekend sale");
  await page.getByLabel("Email", { exact: true }).fill("Hi {first_name}, everything is 15% off.");
  await page.getByRole("button", { name: "Save and preview" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await expect(page.getByText("Add your mailing address")).toBeVisible();

  await page.goto("/admin/campaigns");
  await page.getByRole("textbox", { name: "Mailing address" }).fill("12 Elm St, Austin TX 78701");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByText("Address saved.")).toBeVisible();
  await page.getByRole("link", { name: "Weekend sale" }).click();
  await page.getByText("Schedule", { exact: true }).click();
  await page.getByLabel("Date and time").fill("2031-01-15T09:30");
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByRole("heading", { name: /^Scheduled for Jan 15/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancel and edit" }).click();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
});
