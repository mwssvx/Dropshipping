import { expect, test } from "@playwright/test";

// The home page's buyer reviews section: real published reviews at or above a star line, with the
// store's average over every review.

test("the home page shows the store's real reviews", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Rated ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Rated/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;

  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,,Ada L.,ada@example.com,,"Warm light, perfect for the bedroom.",,2025-03-04 10:00:00 UTC,`,
    `${handle},published,3,,Bob K.,bob@example.com,,Just okay.,,2025-03-05 10:00:00 UTC,`,
  ].join("\n");
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("2 reviews added");

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("reviews");
  await page.getByLabel("Heading").fill("What buyers say");
  await expect(preview.getByRole("heading", { name: "What buyers say" })).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product.replace(/\/products\/.*$/, "/"));
  const section = buyer.locator("section.sf-reviews");
  await expect(section.getByRole("heading", { name: "What buyers say" })).toBeVisible();
  // Four stars and up by default, but the average counts every review.
  await expect(section.getByText("Warm light, perfect for the bedroom.")).toBeVisible();
  await expect(section.getByText("Just okay.")).toHaveCount(0);
  await expect(section.getByText("2 reviews")).toBeVisible();
  await expect(section.getByRole("img", { name: "4 out of 5 stars" })).toBeVisible();
  await section.getByRole("link", { name: "Sunset Projection Lamp" }).click();
  await expect(buyer).toHaveURL(new RegExp(`/products/${handle}$`));
  await buyer.context().close();
});
