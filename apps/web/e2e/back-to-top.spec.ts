import { expect, test } from "@playwright/test";

// With the theme setting on, a "Back to top" button appears once a shopper has scrolled two
// screens down, takes them back up and puts keyboard focus in the header.

const pad = (n: number) => String(n).padStart(2, "0");
const FILE = [
  "Handle,Title,Body (HTML),Vendor,Published,Option1 Name,Option1 Value,Variant SKU,Variant Inventory Tracker,Variant Inventory Qty,Variant Price,Variant Compare At Price,Image Src,Image Position,Gift Card,SEO Title,SEO Description,Cost per item,Status",
  ...Array.from({ length: 24 }, (_, i) => `mug-${pad(i + 1)},Mug ${pad(i + 1)},<p>A mug.</p>,Acme,true,Title,Default Title,,,,12.${pad(i + 1)},,,,false,,,,active`),
].join("\n");

test("a long collection gets a Back to top button when the theme asks for it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`top-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Top ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Top/ })).toBeVisible();
  await page.goto("/admin/products/move");
  await page.getByLabel("Shopify products file (CSV)").setInputFiles({ name: "products_export.csv", mimeType: "text/csv", buffer: Buffer.from(FILE) });
  await page.getByLabel(/Put products that are active on Shopify on sale/).check();
  await page.getByRole("button", { name: "Add products" }).click();
  await expect(page.getByText("24 products added.")).toBeVisible();
  const store = `/s/top-${id}`.toLowerCase();

  const buyerContext = await browser.newContext({ ...info.project.use, viewport: { width: info.project.use.viewport?.width ?? 1280, height: 500 } });
  const buyer = await buyerContext.newPage();
  const back = buyer.getByRole("button", { name: "Back to top" });
  // Off by default.
  await buyer.goto(`${store}/collections/all`);
  await buyer.mouse.wheel(0, 3000);
  await buyer.waitForFunction(() => window.scrollY > 1000);
  await expect(back).toHaveCount(0);

  await page.goto("/admin/theme");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Show a “Back to top” button on long pages").check();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await buyer.goto(`${store}/collections/all`);
  await expect(back).toHaveCount(0);
  await buyer.mouse.wheel(0, 3000);
  await expect(back).toBeVisible();
  await back.click();
  await buyer.waitForFunction(() => window.scrollY === 0);
  await expect(back).toHaveCount(0);
  await expect(buyer.locator("header").locator(":focus")).toHaveCount(1);
  await buyerContext.close();
});
