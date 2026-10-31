import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A shopper reports a review; the merchant sees it under Reported and keeps it or hides it.

test("shoppers report a review and the merchant deals with it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`report-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Reports ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Reports/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;

  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,,Spam review,s@example.com,,Cheap watches at my site.,,2025-03-01 10:00:00 UTC,`,
    `${handle},published,4,,Honest review,h@example.com,,Nice light and easy to set up.,,2025-03-02 10:00:00 UTC,`,
  ].join("\n");
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("2 reviews added");
  await page.goto("/admin/reviews?show=published");
  const filters = page.getByRole("navigation", { name: "More filters" });
  await expect(filters.getByRole("link", { name: /Reported/ })).toHaveCount(0);

  const shopper = await (await browser.newContext({ ...info.project.use })).newPage();
  await shopper.goto(product);
  const spam = shopper.locator('#reviews li[id^="review-"]', { hasText: "Spam review" });
  await spam.getByRole("button", { name: "Report the review by Spam review" }).click();
  await expect(shopper).toHaveURL(/#review-[0-9a-f-]+$/);
  await expect(spam.getByText("Reported. The store will take a look.")).toBeVisible();
  await expect(spam.getByRole("button", { name: /Report/ })).toHaveCount(0);
  // It stays up, and the other review can still be reported.
  await expect(shopper.locator('#reviews li[id^="review-"]')).toHaveCount(2);
  const honest = shopper.locator('#reviews li[id^="review-"]', { hasText: "Honest review" });
  await honest.getByRole("button", { name: "Report the review by Honest review" }).click();
  await expect(honest.getByText("Reported. The store will take a look.")).toBeVisible();
  const result = await new AxeBuilder({ page: shopper }).include("#reviews").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);

  await page.reload();
  await filters.getByRole("link", { name: "Reported (2)" }).click();
  await expect(page).toHaveURL(/reported=1/);
  const cards = page.getByRole("listitem", { name: /^Review by/ });
  await expect(cards).toHaveCount(2);
  const merchantSpam = page.getByRole("listitem", { name: "Review by Spam review" });
  await expect(merchantSpam.getByText("Reported by a shopper.")).toBeVisible();
  const admin = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(admin.violations.map((v) => v.id)).toEqual([]);

  // Keep the honest one, hide the spam.
  await page.getByRole("listitem", { name: "Review by Honest review" }).getByRole("button", { name: "Keep it" }).click();
  await expect(cards).toHaveCount(1);
  await expect(filters.getByRole("link", { name: "Reported (1)" })).toBeVisible();
  await merchantSpam.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByText("No reviews match.")).toBeVisible();
  await page.goto("/admin/reviews?show=published");
  await expect(filters.getByRole("link", { name: /Reported/ })).toHaveCount(0);

  await shopper.reload();
  await expect(shopper.locator('#reviews li[id^="review-"]')).toHaveCount(1);
  await expect(honest.getByText("Reported. The store will take a look.")).toBeVisible();
});
