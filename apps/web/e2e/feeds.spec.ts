import { expect, test, type Page } from "@playwright/test";

// Product feeds: the merchant finds their Google and Meta feed links on Sales channels, sees what
// kept a product out, and the links serve every product with a photo.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant gets feed links for Google and Meta, and fixes what's missing", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`feeds-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Feeds ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Feeds/ })).toBeVisible();
  for (const name of [/sunset projection lamp/i, /galaxy projector low stock/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  }
  // The projector (imported last) gets a photo; the lamp doesn't yet.
  const photos = page.getByRole("region", { name: "Photos" });
  await photos.getByLabel("Or paste its address").fill("https://img.example.com/projector.jpg");
  await photos.getByRole("button", { name: "Add photo" }).click();
  await expect(photos.getByText("Photo added.")).toBeVisible();

  await page.goto("/admin/channels");
  await expect(page.getByRole("heading", { name: "Sales channels" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/1 product \(\d options?\) in your feeds, 1 thing to fix below/);
  // What Merchant Center checks first: barcodes and shipping.
  const details = page.getByRole("region", { name: "What the feeds send" });
  await expect(details).toContainText(/0 of \d options? have a barcode/);
  await expect(details).toContainText(/Shipping to United States: (free|from \$)/);
  const toFix = page.getByRole("region", { name: "To fix" });
  await expect(toFix).toContainText("Sunset Projection Lamp: Add a photo.");
  const google = await page.getByLabel("Google Shopping feed link").inputValue();
  expect(google).toMatch(/\/feeds\/google\.xml$/);
  await expect(page.getByLabel("Facebook and Instagram feed link")).toHaveValue(/\/feeds\/meta\.csv$/);
  // Pinterest and TikTok read the same file as Google.
  await expect(page.getByLabel("Pinterest feed link")).toHaveValue(google);
  await expect(page.getByLabel("TikTok feed link")).toHaveValue(google);
  await shot(page, "144-sales-channels");

  // The browser opens the feed the way a channel fetches it (store hosts only resolve in the browser).
  const xml = await (await page.goto(google))!.text();
  expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
  expect(xml).toContain("<g:image_link>https://img.example.com/projector.jpg</g:image_link>");
  expect(xml).toContain("/products/galaxy-projector-low-stock</g:link>");
  expect(xml).not.toContain("Sunset Projection Lamp");
  const csv = (await page.evaluate((u) => fetch(u).then((r) => r.text()), google.replace("google.xml", "meta.csv"))).split("\n");
  expect(csv[0]).toMatch(/^id,item_group_id,title,/);
  expect(csv.length).toBeGreaterThan(1);
});
