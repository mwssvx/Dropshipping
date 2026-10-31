import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Shoppers mark reviews helpful (once per device; a second tap takes it back) and can list the
// most helpful first.

test("shoppers mark reviews helpful and sort by it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`helpful-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Helpful ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Helpful/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;

  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,,Old review,o@example.com,,The oldest one and the most useful.,,2025-03-01 10:00:00 UTC,`,
    `${handle},published,4,,Middle review,m@example.com,,Somewhere in between.,,2025-03-02 10:00:00 UTC,`,
    `${handle},published,3,,New review,n@example.com,,The newest one.,,2025-03-03 10:00:00 UTC,`,
  ].join("\n");
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("3 reviews added");

  // Two shoppers on two devices.
  const shopper = async () => {
    const context = await browser.newContext({ ...info.project.use });
    const tab = await context.newPage();
    await tab.goto(product);
    return { context, tab, section: tab.locator("#reviews") };
  };
  const ada = await shopper();
  const names = ada.section.locator('li[id^="review-"] .font-medium');
  await expect(names).toHaveText(["New review", "Middle review", "Old review"]);
  const old = ada.section.locator('li[id^="review-"]', { hasText: "Old review" });
  const helpful = old.getByRole("button", { name: "Helpful" });
  await expect(helpful).toHaveAttribute("aria-pressed", "false");
  await helpful.click();
  await expect(ada.tab).toHaveURL(/#review-[0-9a-f-]+$/);
  await expect(helpful).toHaveAttribute("aria-pressed", "true");
  await expect(old.getByText("1 person found this helpful")).toBeVisible();
  const result = await new AxeBuilder({ page: ada.tab }).include("#reviews").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);

  const ben = await shopper();
  const benOld = ben.section.locator('li[id^="review-"]', { hasText: "Old review" });
  await expect(benOld.getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "false");
  await benOld.getByRole("button", { name: "Helpful" }).click();
  await expect(benOld.getByText("2 people found this helpful")).toBeVisible();
  await ben.context.close();

  // A second tap takes Ada's mark back.
  await helpful.click();
  await expect(helpful).toHaveAttribute("aria-pressed", "false");
  await expect(old.getByText("1 person found this helpful")).toBeVisible();
  await helpful.click();
  await expect(old.getByText("2 people found this helpful")).toBeVisible();

  const sorting = ada.section.getByRole("navigation", { name: "Sort reviews" });
  await expect(sorting.getByRole("link", { name: "Newest" })).toHaveAttribute("aria-current", "true");
  await sorting.getByRole("link", { name: "Most helpful" }).click();
  await expect(ada.tab).toHaveURL(/\?sort=helpful#reviews$/);
  await expect(names).toHaveText(["Old review", "New review", "Middle review"]);
  await expect(sorting.getByRole("link", { name: "Most helpful" })).toHaveAttribute("aria-current", "true");
  // The order stays when picking a star rating.
  await ada.section.getByRole("list", { name: "How buyers rated it" }).getByRole("link", { name: /^5 stars/ }).click();
  await expect(ada.tab).toHaveURL(/\?stars=5&sort=helpful#reviews$/);
  await expect(names).toHaveText(["Old review"]);
  await ada.context.close();
});
