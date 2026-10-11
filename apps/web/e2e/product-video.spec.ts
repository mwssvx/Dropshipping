import { expect, test, type Page } from "@playwright/test";

// Product videos: a YouTube or Vimeo link, or a video file, after the photos on the product page.
// The YouTube player only loads once the buyer presses play.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a product video plays only when the buyer asks", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`video-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Video ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Video/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const section = page.getByRole("region", { name: "Video" });
  await section.getByLabel("Video link").fill("https://example.com/lamp");
  await section.getByRole("button", { name: "Save video" }).click();
  await expect(section.getByText("Paste a YouTube or Vimeo link, or the https address of a video file")).toBeVisible();
  await section.getByLabel("Video link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await section.getByRole("button", { name: "Save video" }).click();
  await expect(section.getByText("Saved. The video shows after the photos on the product page.")).toBeVisible();

  // Nothing from YouTube loads until the buyer presses play (and the test never reaches it).
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const youtube: string[] = [];
  await buyer.route(/youtube|ytimg/, (route) => {
    youtube.push(route.request().url());
    return route.abort();
  });
  await buyer.goto(product);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  // This product has no photos, so the video is the main picture.
  await expect(buyer.getByRole("button", { name: "Play video" })).toBeVisible();
  await expect(buyer.locator("iframe")).toHaveCount(0);
  await shot(buyer, "371-product-video-poster");
  expect(youtube).toEqual([]);
  await buyer.getByRole("button", { name: "Play video" }).click();
  await expect(buyer.locator("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1");

  // With photos, the video comes after them.
  await page.getByLabel("Or paste its address").fill("https://images.example.com/lamp.jpg");
  await page.getByRole("button", { name: "Add photo" }).click();
  await expect(page.getByRole("button", { name: "Remove photo 1" })).toBeVisible();
  await buyer.reload();
  await expect(buyer.locator("iframe")).toHaveCount(0);
  await buyer.getByRole("button", { name: "Video", exact: true }).click();
  await buyer.getByRole("button", { name: "Play video" }).click();
  await expect(buyer.locator("iframe")).toHaveCount(1);
  await buyer.getByRole("button", { name: "Show photo 1" }).click();
  await expect(buyer.locator("iframe")).toHaveCount(0);

  // A supplier's video file plays in the page's own player.
  await section.getByLabel("Video link").fill("https://cdn.example.com/lamp.mp4");
  await section.getByRole("button", { name: "Save video" }).click();
  await expect(section.getByText("Saved. The video shows after the photos on the product page.")).toBeVisible();
  // The banner from the last save reads the same, so check the store until the new video is there.
  await expect(async () => {
    await buyer.reload();
    await buyer.getByRole("button", { name: "Video", exact: true }).click({ timeout: 2000 });
    await expect(buyer.locator("video")).toHaveAttribute("src", "https://cdn.example.com/lamp.mp4", { timeout: 2000 });
  }).toPass();

  // Removing it.
  await section.getByLabel("Video link").fill("");
  await section.getByRole("button", { name: "Save video" }).click();
  await expect(section.getByText("Saved. This product has no video.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "Video", exact: true })).toHaveCount(0);
});
