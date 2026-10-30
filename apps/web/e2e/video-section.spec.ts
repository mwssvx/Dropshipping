import { expect, test } from "@playwright/test";

// The home page's video section: nothing loads from YouTube until the shopper presses play, and a
// link that isn't a video is refused with a reason.

test("a merchant puts a video on the home page that loads only on play", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`video-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Video ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Video/ })).toBeVisible();
  const handle = `video-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("video");
  await page.getByLabel("Heading").fill("How it's made");
  await page.getByLabel("Video link").fill("https://example.com/about");
  await expect(page.getByText(/Paste a YouTube or Vimeo link/)).toBeVisible();
  await page.getByLabel("Video link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(preview.getByRole("region", { name: "How it's made" }).getByRole("button", { name: "Play video" })).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const context = await browser.newContext({ ...info.project.use });
  const youtube: string[] = [];
  await context.route(/youtube|ytimg/, (route) => {
    youtube.push(route.request().url());
    return route.abort();
  });
  const buyer = await context.newPage();
  await buyer.goto(`/s/${handle}`);
  const section = buyer.getByRole("region", { name: "How it's made" });
  await expect(section.getByRole("button", { name: "Play video" })).toBeVisible();
  await expect(section.locator("iframe")).toHaveCount(0);
  expect(youtube).toEqual([]);
  await section.getByRole("button", { name: "Play video" }).click();
  await expect(section.locator("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1");
  await context.close();
});
