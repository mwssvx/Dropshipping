import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The merchant narrows the Reviews page to reviews they haven't answered yet, or ones with photos.

test("the merchant lists reviews with no reply yet", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rf-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Filters ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Filters/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;

  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,,Answered review,a@example.com,,Lovely light in the evening.,Thank you!,2025-03-01 10:00:00 UTC,2025-03-02 10:00:00 UTC`,
    `${handle},published,2,,Unhappy review,u@example.com,,The cable is too short.,,2025-03-02 10:00:00 UTC,`,
    `${handle},published,4,,Quiet review,q@example.com,,Does the job.,,2025-03-03 10:00:00 UTC,`,
  ].join("\n");
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("3 reviews added");

  await page.goto("/admin/reviews?show=published");
  const cards = page.getByRole("listitem", { name: /^Review by/ });
  await expect(cards).toHaveCount(3);
  const filters = page.getByRole("navigation", { name: "More filters" });
  await filters.getByRole("link", { name: "No reply yet" }).click();
  await expect(page).toHaveURL(/reply=none/);
  await expect(filters.getByRole("link", { name: "No reply yet" })).toHaveAttribute("aria-current", "true");
  await expect(cards).toHaveCount(2);
  await expect(page.getByText("2 reviews match, no reply yet.")).toBeVisible();
  const result = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);

  // Stars narrow it further and keep the filter.
  await page.getByRole("navigation", { name: "Star filter" }).getByRole("link", { name: "2 stars" }).click();
  await expect(page).toHaveURL(/stars=2/);
  await expect(page).toHaveURL(/reply=none/);
  await expect(cards).toHaveCount(1);
  await page.getByRole("navigation", { name: "Star filter" }).getByRole("link", { name: "All stars" }).click();

  // Answering one takes it off the list.
  const unhappy = page.getByRole("listitem", { name: "Review by Unhappy review" });
  await unhappy.getByRole("button", { name: "Reply" }).click();
  await unhappy.getByLabel("Public reply").fill("Sorry about that, a longer cable is on its way.");
  await unhappy.getByRole("button", { name: "Save reply" }).click();
  await expect(unhappy).toHaveCount(0);
  await expect(cards).toHaveCount(1);

  // None of these have photos; Clear brings everything back.
  await filters.getByRole("link", { name: "With photos" }).click();
  await expect(page).toHaveURL(/photos=1/);
  await expect(page.getByText("No reviews match.")).toBeVisible();
  await page.getByRole("link", { name: "Clear" }).click();
  await expect(cards).toHaveCount(3);
  await expect(filters.getByRole("link", { name: "No reply yet" })).not.toHaveAttribute("aria-current", "true");
});
