import { expect, test, type Page } from "@playwright/test";

// Customer profiles: one page per buyer with their orders and addresses, the merchant's note and
// tags, and answers to privacy requests (download their data, erase it).

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant tags a customer, downloads their data and erases it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cu-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Regulars ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Regulars/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const email = `cu-buyer-${id}@example.com`;
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

  // The profile: orders, address, and the merchant's own note and tags.
  await page.goto("/admin/customers");
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "#1001" })).toBeVisible();
  await expect(page.getByLabel("Summary")).toContainText("Orders1");
  await expect(page.locator("address")).toContainText("1 Main St");
  await page.getByLabel("Tags", { exact: true }).fill("VIP,  gift wrap");
  await page.getByLabel("Note", { exact: true }).fill("Prefers gift wrap.");
  await page.getByRole("button", { name: "Save note and tags" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValue("vip, gift wrap");
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue("Prefers gift wrap.");
  await shot(page, "118-customer-profile");

  // Filtering the list by a tag.
  await page.getByRole("link", { name: "← Customers" }).click();
  await page.getByLabel("Filter by tag").getByRole("link", { name: /^vip/ }).click();
  await expect(page).toHaveURL(/tag=vip/);
  await expect(page.getByRole("link", { name: "Ada Lovelace" })).toBeVisible();
  await shot(page, "119-customers-by-tag");

  // A privacy request: their data as a file, then erasing it.
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  const href = (await page.getByRole("link", { name: "Download their data" }).getAttribute("href"))!;
  const file = await page.request.get(href);
  expect(file.headers()["content-disposition"]).toContain("attachment");
  const data = await file.json();
  expect(data.customer).toMatchObject({ email, merchant_note: "Prefers gift wrap.", tags: ["vip", "gift wrap"] });
  expect(data.orders[0]).toMatchObject({ number: 1001, shipping_address: { line1: "1 Main St" } });

  // The order hasn't shipped yet, so erasing waits.
  await page.getByText("Erase their data on request").click();
  await page.getByLabel("Type their email to confirm").fill(email);
  await page.getByRole("button", { name: "Erase their data" }).click();
  await expect(page.getByText("Order #1001 hasn't reached them yet. Finish or refund it first, then erase their data.")).toBeVisible();

  await page.getByRole("link", { name: "#1001" }).click();
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText("Checked just now.")).toBeVisible();
  await page.getByRole("link", { name: "View customer" }).click();
  await page.getByText("Erase their data on request").click();
  await page.getByLabel("Type their email to confirm").fill(email.toUpperCase());
  await page.getByRole("button", { name: "Erase their data" }).click();
  await expect(page.getByText("Their data is erased. 1 order keeps only the amounts and country for your records.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ada Lovelace" })).toHaveCount(0);

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).click();
  await expect(page.getByText("Erased").first()).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View customer" })).toHaveCount(0);
});
