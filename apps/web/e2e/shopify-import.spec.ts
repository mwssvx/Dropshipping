import { expect, test, type Page } from "@playwright/test";

// Moving from Shopify: the merchant uploads the products file Shopify exports, and the products
// arrive with their options, prices and web addresses.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const FILE = [
  "Handle,Title,Body (HTML),Vendor,Published,Option1 Name,Option1 Value,Variant SKU,Variant Inventory Tracker,Variant Inventory Qty,Variant Price,Variant Compare At Price,Image Src,Image Position,Gift Card,SEO Title,SEO Description,Cost per item,Status",
  'cloud-lamp,Cloud Lamp,"<p>A soft, glowing cloud.</p>",Acme,true,Color,White,CL-W,shopify,12,29.99,39.99,,,false,Cloud Lamp | Night light,A soft cloud lamp for any room.,8.50,active',
  ",,,,,,Pink,CL-P,shopify,4,31.99,,,,,,,,",
  "plain-mug,Plain Mug,<p>Holds tea.</p>,Acme,true,Title,Default Title,,,,12.00,,,,false,,,,draft",
  "gift-card,Gift Card,,Acme,true,Denominations,$25,,,,25.00,,,,true,,,,active",
].join("\n").replace("\n,,,,,,Pink", "\ncloud-lamp,,,,,,Pink");

test("products come over from a Shopify export", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`move-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Moved ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Moved/ })).toBeVisible();

  await page.goto("/admin/products");
  await page.getByRole("link", { name: "Moving from Shopify? Bring your products over" }).click();
  await expect(page.getByRole("heading", { name: "Move from Shopify" })).toBeVisible();

  // Something that isn't a Shopify file is turned away.
  await page.getByLabel("Shopify products file (CSV)").setInputFiles({ name: "other.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Price\nLamp,10\n") });
  await page.getByRole("button", { name: "Add products" }).click();
  await expect(page.getByText(/That isn't a Shopify products file\./)).toBeVisible();

  await page.getByLabel("Shopify products file (CSV)").setInputFiles({ name: "products_export.csv", mimeType: "text/csv", buffer: Buffer.from(FILE) });
  await page.getByLabel(/Put products that are active on Shopify on sale/).check();
  await page.getByRole("button", { name: "Add products" }).click();
  await expect(page.getByText("2 products added.")).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Gift Card is a gift card. Make gift cards under Gift cards instead.");
  await shot(page, "371-move-from-shopify");

  // The same file again adds nothing.
  await page.getByLabel("Shopify products file (CSV)").setInputFiles({ name: "products_export.csv", mimeType: "text/csv", buffer: Buffer.from(FILE) });
  await page.getByRole("button", { name: "Add products" }).click();
  await expect(page.getByText(/^0 products added\. 2 were already in your store/)).toBeVisible();

  // The lamp is on sale at the same address, with both colours and prices.
  await page.goto("/admin/products");
  await page.getByRole("link", { name: "Cloud Lamp" }).first().click();
  await expect(page).toHaveURL(/\/admin\/products\/[^/]+$/);
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  expect(store).toMatch(/\/products\/cloud-lamp$/);
  await page.goto(store);
  await expect(page.getByRole("heading", { name: "Cloud Lamp" })).toBeVisible();
  await expect(page.getByText("$29.99").first()).toBeVisible();
  await expect(page.getByText("Pink", { exact: true })).toBeVisible();
  await shot(page, "372-moved-product");
  // The mug was a draft on Shopify, so it stays off the store.
  const mug = await page.request.get(store.replace("cloud-lamp", "plain-mug"));
  expect(mug.status()).toBe(404);
});
