import { expect, test, type Page } from "@playwright/test";

// Photo reviews: a buyer adds photos to their review, they show on the product page, and the
// merchant can take one down.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

// A tiny real PNG (1x1), so the upload passes the photo check.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("a buyer adds photos to a review and they show on the product page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Photos ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Photos/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  // Publish reviews straight away, so the photos show without a step in between.
  await page.goto("/admin/reviews");
  await page.getByLabel("Publish new reviews straight away").check();
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByLabel("Publish new reviews straight away")).toBeChecked({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const orderPage = buyer.url();

  // The demo supplier ships at once; once tracking is in, the buyer can review.
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Check for tracking now" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText(/Shipped with Demo Post/).first()).toBeVisible();

  await buyer.goto(orderPage);
  const form = buyer.getByRole("form", { name: "Review Sunset Projection Lamp" });
  await form.getByLabel("5 stars").check({ force: true });
  await form.getByLabel("Your review").fill("Fills the whole ceiling with colour.");
  await form.getByLabel("Name to show").fill("Ada B.");
  // A file that isn't a photo is refused.
  await form.getByLabel("Add photos (optional)").setInputFiles({ name: "notes.jpg", mimeType: "image/jpeg", buffer: Buffer.from("just some text") });
  await form.getByRole("button", { name: "Send review" }).click();
  await expect(buyer.getByText("Use a JPG, PNG or WebP photo.")).toBeVisible();
  await form.getByLabel("Add photos (optional)").setInputFiles([
    { name: "ceiling.png", mimeType: "image/png", buffer: PNG },
    { name: "lamp.png", mimeType: "image/png", buffer: PNG },
  ]);
  await form.getByRole("button", { name: "Send review" }).click();
  await expect(buyer.getByText(/you gave it 5 of 5 stars/)).toBeVisible();

  await buyer.goto(store);
  const strip = buyer.getByRole("list", { name: "Photos from buyers" });
  await expect(strip.getByRole("img")).toHaveCount(2);
  await expect(strip.getByRole("img", { name: "Photo 1 from Ada B." })).toBeVisible();
  // The photo really loads.
  const src = await strip.getByRole("img").first().getAttribute("src");
  expect((await buyer.request.get(src!)).headers()["content-type"]).toBe("image/png");
  await shot(buyer, "280-photo-reviews");

  // The merchant takes one down.
  await page.goto("/admin/reviews?show=published");
  const review = page.getByRole("listitem", { name: "Review by Ada B." });
  await expect(review.getByRole("list", { name: "Buyer's photos" }).getByRole("img")).toHaveCount(2);
  await review.getByRole("button", { name: "Remove photo 1 from Ada B." }).click();
  await expect(review.getByRole("list", { name: "Buyer's photos" }).getByRole("img")).toHaveCount(1);
  await buyer.reload();
  await expect(buyer.getByRole("list", { name: "Photos from buyers" }).getByRole("img")).toHaveCount(1);

  // Shoppers can list only the reviews with photos, and tap again to see them all.
  const reviews = buyer.locator("#reviews");
  const withPhotos = reviews.getByRole("link", { name: "With photos (1)" });
  await withPhotos.click();
  await expect(buyer).toHaveURL(/\?photos=1#reviews$/);
  await expect(withPhotos).toHaveAttribute("aria-current", "true");
  await expect(reviews.locator('li[id^="review-"]')).toHaveCount(1);
  await withPhotos.click();
  await expect(buyer).toHaveURL(/\/products\/[^?]+#reviews$/);
  await expect(withPhotos).not.toHaveAttribute("aria-current", "true");
});
