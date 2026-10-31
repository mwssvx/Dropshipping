import { expect, test } from "@playwright/test";

// The home page's scrolling text: short messages gliding across in a loop, with a pause button,
// and a still row for shoppers who ask for less motion.

test("a merchant adds scrolling text and shoppers can stop it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`marquee-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Marquee ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Marquee/ })).toBeVisible();
  const handle = `marquee-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("scrolling_text");
  await page.getByRole("button", { name: "Add a message" }).click();
  await page.getByLabel("Message 1").fill("Free shipping over $50");
  await page.getByRole("button", { name: "Add a message" }).click();
  await page.getByLabel("Message 2").fill("30-day returns");
  await page.getByRole("button", { name: "Add a message" }).click();
  const row = preview.getByRole("region", { name: "Scrolling text" });
  await row.scrollIntoViewIfNeeded();
  // The empty third message isn't shown, and screen readers hear each message once.
  await expect(row.getByRole("listitem")).toHaveCount(2);
  await expect(row.getByText("30-day returns", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "Scrolling text" });
  await live.scrollIntoViewIfNeeded();
  await expect(live.getByRole("listitem").filter({ hasText: "Free shipping over $50" })).toBeVisible();
  const track = live.locator(".sf-marquee-track");
  await expect(track).toHaveCSS("animation-play-state", "running");
  await buyer.mouse.move(0, 0);
  await live.getByRole("button", { name: "Pause the scrolling text" }).click();
  await buyer.mouse.move(0, 0);
  await expect(track).toHaveCSS("animation-play-state", "paused");
  await live.getByRole("button", { name: "Play the scrolling text" }).click();
  await buyer.mouse.move(0, 0);
  await expect(track).toHaveCSS("animation-play-state", "running");
  await buyer.context().close();

  // Less motion: a still row with each message once, and nothing to pause.
  const calm = await (await browser.newContext({ ...info.project.use, reducedMotion: "reduce" })).newPage();
  await calm.goto(`/s/${handle}`);
  const still = calm.getByRole("region", { name: "Scrolling text" });
  await expect(still.getByText("30-day returns", { exact: true })).toHaveCount(1);
  await expect(still.getByRole("button")).toHaveCount(0);
  await calm.context().close();
});
