import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A product page's reviews come with how many there are of each star rating; a row shows only the
// reviews with that many stars, and a long list starts with the newest 20.

test("shoppers see the star breakdown and read only the reviews they pick", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`stars-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Stars ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Stars/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;

  // 21 five-star reviews, one four-star and one two-star.
  const ratings = [...Array(21).fill(5), 4, 2] as number[];
  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    ...ratings.map((r, i) => `${handle},published,${r},,Buyer ${i},b${i}@example.com,,Review ${i} gives it ${r}.,,2025-03-${String(1 + i).padStart(2, "0")} 10:00:00 UTC,`),
  ].join("\n");
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("23 reviews added");

  const buyerContext = await browser.newContext({ ...info.project.use });
  const buyer = await buyerContext.newPage();
  await buyer.goto(product);
  const section = buyer.locator("#reviews");
  const breakdown = section.getByRole("list", { name: "How buyers rated it" });
  await breakdown.scrollIntoViewIfNeeded();
  await expect(breakdown.getByRole("listitem")).toHaveText([/^5 stars\s*21/, /^4 stars\s*1/, /^3 stars\s*0/, /^2 stars\s*1/, /^1 star\s*0/]);
  // Ratings nobody gave aren't links.
  await expect(breakdown.getByRole("link")).toHaveCount(3);
  const reviews = section.locator('li[id^="review-"]');
  await expect(reviews).toHaveCount(20);
  const result = await new AxeBuilder({ page: buyer }).include("#reviews").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);

  await breakdown.getByRole("link", { name: /^2 stars/ }).click();
  await expect(buyer).toHaveURL(/\?stars=2#reviews$/);
  await expect(section.getByText("Only 2-star reviews")).toBeVisible();
  await expect(reviews).toHaveCount(1);
  await expect(reviews).toContainText("Review 22 gives it 2.");
  await expect(breakdown.getByRole("link", { name: /^2 stars/ })).toHaveAttribute("aria-current", "true");

  await section.getByRole("link", { name: "All reviews" }).click();
  await expect(reviews).toHaveCount(20);
  await section.getByRole("link", { name: "Show all 23 reviews" }).click();
  await expect(reviews).toHaveCount(23);
  await expect(section.getByRole("link", { name: /Show all/ })).toHaveCount(0);
  await buyerContext.close();
});
