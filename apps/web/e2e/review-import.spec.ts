import { expect, test, type Page } from "@playwright/test";

// Bringing reviews over: a review app's export from Shopify adds reviews to the matching products.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the merchant brings their Shopify reviews over", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`reviews-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Reviews ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Reviews/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;

  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  await expect(page.getByRole("heading", { name: "Bring your reviews over" })).toBeVisible();
  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,Love it,Ada L.,ada@example.com,Austin,"Warm light, perfect for the bedroom.",Thanks Ada!,2025-03-04 10:00:00 UTC,`,
    `${handle},unpublished,2,,Grace H.,grace@example.com,,Smaller than I thought.,,2025-04-01 12:00:00 UTC,`,
    "old-product,published,4,,Sam,sam@example.com,,Nice,,2025-04-03 12:00:00 UTC,",
  ].join("\n");
  const upload = () => page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await upload();
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("2 reviews added from Shopify Product Reviews.");
  await expect(page.getByRole("status")).toContainText("1 review is for products that aren't in your store yet (old-product)");
  await shot(page, "430-reviews-import");
  // The same file again adds nothing.
  await upload();
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("0 reviews added from Shopify Product Reviews, 2 reviews were already here.");

  await page.getByRole("link", { name: "See your reviews" }).click();
  const review = page.getByRole("listitem", { name: "Review by Ada L." });
  await expect(review).toContainText("from Shopify Product Reviews · Mar 4, 2025");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await expect(buyer.getByText("Love it")).toBeVisible();
  await expect(buyer.getByText("Thanks Ada!")).toBeVisible();
  // Not from an order here, so not marked verified; the unpublished one stays hidden.
  await expect(buyer.getByText("Verified buyer")).toHaveCount(0);
  await expect(buyer.getByText("Smaller than I thought.")).toHaveCount(0);
});
