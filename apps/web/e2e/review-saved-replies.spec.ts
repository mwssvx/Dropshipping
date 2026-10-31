import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The merchant answers a review from a saved reply, filled in with the reviewer's first name.

test("the merchant replies to a review from a saved reply", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rsr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Thanks ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Thanks/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;

  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,,Grace Hopper,g@example.com,,Lovely light in the evening.,,2025-03-01 10:00:00 UTC,`,
  ].join("\n");
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("1 review added");
  await page.goto("/admin/reviews?show=published");
  const review = page.getByRole("listitem", { name: "Review by Grace Hopper" });
  // No saved replies yet: the reply box points at where to add them.
  await review.getByRole("button", { name: "Reply" }).click();
  await expect(review.getByRole("link", { name: "Save replies you use often" })).toBeVisible();

  await page.goto("/admin/inbox/replies");
  const add = page.getByRole("region", { name: "Add a saved reply" });
  await add.getByLabel("Name", { exact: true }).fill("Thanks for the stars");
  await add.getByLabel("Reply", { exact: true }).fill("Thank you {first_name}! Everyone at {store_name} is glad it lights up your evenings.");
  await add.getByRole("button", { name: "Add reply" }).click();
  await expect(page.getByText("Saved “Thanks for the stars”.")).toBeVisible();
  await add.getByLabel("Name", { exact: true }).fill("Tracking");
  await add.getByLabel("Reply", { exact: true }).fill("Follow it here: {tracking_link}");
  await add.getByRole("button", { name: "Add reply" }).click();
  await expect(page.getByText("Saved “Tracking”.")).toBeVisible();

  await page.goto("/admin/reviews?show=published");
  await review.getByRole("button", { name: "Reply" }).click();
  const box = review.getByLabel("Public reply");
  // A field the review can't fill is flagged, and the reply isn't saved with it.
  await review.getByLabel("Start from").selectOption({ label: "Tracking" });
  await expect(box).toHaveValue("Follow it here: {tracking_link}");
  await expect(review.getByText("Replace {tracking_link} before saving")).toBeVisible();
  await review.getByRole("button", { name: "Save reply" }).click();
  await expect(review.getByText("Replace {tracking_link} first: this review has nothing to fill it with.")).toBeVisible();

  await review.getByLabel("Start from").selectOption({ label: "Thanks for the stars" });
  await expect(box).toHaveValue(`Thank you Grace! Everyone at Thanks ${id} is glad it lights up your evenings.`);
  await expect(review.getByText("Replace {tracking_link} before saving")).toHaveCount(0);
  const result = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await review.getByRole("button", { name: "Save reply" }).click();
  await expect(review.getByText(`Your reply: Thank you Grace! Everyone at Thanks ${id}`)).toBeVisible();

  const shopper = await (await browser.newContext({ ...info.project.use })).newPage();
  await shopper.goto(product);
  await expect(shopper.locator("#reviews")).toContainText("Thank you Grace!");
});
