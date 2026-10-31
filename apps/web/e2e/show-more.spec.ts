import { expect, test, type Page } from "@playwright/test";

// Long collections and search results show 24 products at a time, with "Show more" adding the next
// 24 on the same page and landing on the first new one. Filters and sorting stay as they were.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png` });
};

const pad = (n: number) => String(n).padStart(2, "0");
// 30 lamps priced $10.01 to $10.30, so cheapest first is Lamp 01 to Lamp 30.
const FILE = [
  "Handle,Title,Body (HTML),Vendor,Published,Option1 Name,Option1 Value,Variant SKU,Variant Inventory Tracker,Variant Inventory Qty,Variant Price,Variant Compare At Price,Image Src,Image Position,Gift Card,SEO Title,SEO Description,Cost per item,Status",
  ...Array.from({ length: 30 }, (_, i) => `lamp-${pad(i + 1)},Lamp ${pad(i + 1)},<p>A lamp.</p>,Acme,true,Title,Default Title,,,,10.${pad(i + 1)},,,,false,,,,active`),
].join("\n");

test("long product lists show 24 at a time with Show more", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`more-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`More ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to More/ })).toBeVisible();
  await page.goto("/admin/products/move");
  await page.getByLabel("Shopify products file (CSV)").setInputFiles({ name: "products_export.csv", mimeType: "text/csv", buffer: Buffer.from(FILE) });
  await page.getByLabel(/Put products that are active on Shopify on sale/).check();
  await page.getByRole("button", { name: "Add products" }).click();
  await expect(page.getByText("30 products added.")).toBeVisible();
  const store = `/s/more-${id}`.toLowerCase();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${store}/collections/all?sort=price_asc`);
  const cards = buyer.getByRole("main").getByRole("listitem").filter({ has: buyer.getByRole("link", { name: /^Lamp \d+/ }) });
  await expect(cards).toHaveCount(24);
  await expect(buyer.getByText("Showing 24 of 30 products")).toBeVisible();
  await expect(cards.last()).toContainText("Lamp 24");

  await buyer.getByRole("link", { name: "Show more" }).click();
  await expect(cards).toHaveCount(30);
  await expect(buyer.getByText("Showing 30 of 30 products")).toBeVisible();
  await expect(buyer.getByRole("link", { name: "Show more" })).toHaveCount(0);
  // The sort stayed, and the page went to the first new lamp.
  expect(buyer.url()).toMatch(/[?&]sort=price_asc/);
  expect(buyer.url()).toMatch(/[?&]page=2#item-25$/);
  await expect(cards.nth(24)).toContainText("Lamp 25");
  await expect(cards.nth(24)).toBeInViewport();
  await shot(buyer, "show-more");

  // Filtering starts again from the top.
  await buyer.goto(`${store}/collections/all?sort=price_asc&page=2&max=10.05`);
  await expect(cards).toHaveCount(5);
  await expect(buyer.getByText(/Showing \d+ of/)).toHaveCount(0);
  // A page past the end shows everything, not nothing.
  await buyer.goto(`${store}/collections/all?page=99`);
  await expect(cards).toHaveCount(30);

  // Search works the same way.
  await buyer.goto(`${store}/search?q=lamp`);
  await expect(cards).toHaveCount(24);
  await buyer.getByRole("link", { name: "Show more" }).click();
  await expect(cards).toHaveCount(30);
  expect(buyer.url()).toMatch(/[?&]q=lamp/);
});
