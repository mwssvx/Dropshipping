import { expect, test, type Page } from "@playwright/test";

// The review list with many reviews: counts on each tab, pages, a star filter and search.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the merchant pages through, filters and searches many reviews", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Many reviews ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Many reviews/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const handle = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.split("/products/")[1]!;

  // 60 published reviews, one of them a 1-star from Grace.
  const lines = Array.from({ length: 60 }, (_, i) => {
    const day = String(1 + (i % 28)).padStart(2, "0");
    const month = String(1 + Math.floor(i / 28)).padStart(2, "0");
    return i === 59
      ? `${handle},published,1,,Grace H.,grace@example.com,,The plug snapped off.,,2025-${month}-${day} 12:00:00 UTC,`
      : `${handle},published,5,,Buyer ${i},b${i}@example.com,,Lovely light.,,2025-${month}-${day} 12:00:00 UTC,`;
  });
  const csv = ["product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at", ...lines].join("\n");
  await page.goto("/admin/products/move");
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("60 reviews added");

  await page.goto("/admin/reviews?show=published");
  await expect(page.getByRole("link", { name: /Published \(60\)/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Waiting \(0\)/ })).toBeVisible();
  await expect(page.getByRole("listitem", { name: /^Review by / })).toHaveCount(50);
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Older →" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("listitem", { name: /^Review by / })).toHaveCount(10);

  await page.getByRole("navigation", { name: "Star filter" }).getByRole("link", { name: "1 star" }).click();
  await expect(page).toHaveURL(/stars=1/);
  await expect(page.getByRole("listitem", { name: /^Review by / })).toHaveCount(1);
  await expect(page.getByRole("listitem", { name: "Review by Grace H." })).toContainText("The plug snapped off.");
  await expect(page.getByText("1 review matches with 1 star.")).toBeVisible();
  await shot(page, "460-review-pages");

  await page.getByRole("link", { name: "Clear" }).click();
  await expect(page).not.toHaveURL(/stars=/);
  await page.getByLabel("Search reviews").fill("buyer 12");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=buyer/);
  await expect(page.getByRole("listitem", { name: /^Review by / })).toHaveCount(1);
  await expect(page.getByRole("listitem", { name: "Review by Buyer 12" })).toBeVisible();
});
