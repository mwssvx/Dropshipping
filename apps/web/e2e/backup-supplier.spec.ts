import { expect, test, type Page } from "@playwright/test";

// Backup supplier: the main supplier is out of stock, so the paid order goes to the backup listing
// instead of becoming a problem.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("an out-of-stock order goes to the backup supplier", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bk-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Stars ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Stars/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /galaxy projector low stock/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const admin = page.url();

  const backup = page.getByRole("region", { name: "Backup supplier" });
  await backup.getByLabel("Backup supplier link").fill("https://demo-supplier.test/p/sunset-projection-lamp-2");
  await backup.getByRole("button", { name: "Add backup" }).click();
  await expect(backup.getByRole("alert")).toContainText("None of that listing's options (Default) match");
  await backup.getByLabel("Backup supplier link").fill("https://demo-supplier.test/p/galaxy-projector");
  await backup.getByRole("button", { name: "Add backup" }).click();
  await expect(backup.getByText("Backup saved. Orders go there when the main supplier is out of stock.")).toBeVisible();
  await expect(backup.getByRole("list", { name: "Backup options" })).toContainText(/Small\s*costs \$[\d.]+ \(main: \$[\d.]+\)/);
  await shot(page, "251-backup-supplier");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
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

  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Sent to backup")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("The main supplier was out of stock, so it went to the backup supplier (Demo supplier).").first()).toBeVisible();
  await expect(page.getByText("Not placed. See the problem above.")).toHaveCount(0);
  await shot(page, "252-order-sent-to-backup");

  await page.goto(admin);
  await backup.getByRole("button", { name: "Remove backup" }).click();
  await expect(backup.getByText("Backup removed.")).toBeVisible();
  await expect(backup.getByRole("button", { name: "Add backup" })).toBeVisible();
});
