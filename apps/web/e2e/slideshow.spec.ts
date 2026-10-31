import { expect, test } from "@playwright/test";

// The home page slideshow: big slides that take turns, with arrows, dots and a pause button.
// Slides not on screen are inert, so their buttons can't be reached.

const PIC = "https://images.example.com/summer.svg";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#357"/></svg>';

test("a merchant adds a slideshow and shoppers can step through and pause it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  // Serve the picture from the test so it doesn't depend on the network.
  await page.context().route(PIC, (r) => r.fulfill({ contentType: "image/svg+xml", body: SVG }));
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`slides-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Slides ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Slides/ })).toBeVisible();
  const handle = `slides-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("slideshow");
  await page.getByRole("button", { name: "Add a slide" }).click();
  await page.getByLabel("Slide picture 1").fill(PIC);
  await page.getByLabel("Slide heading 1").fill("Summer is here");
  await page.getByLabel("Slide button label 1").fill("Shop summer");
  await page.getByLabel("Slide button link 1").fill("/collections/all");
  await page.getByRole("button", { name: "Add a slide" }).click();
  await page.getByLabel("Slide heading 2").fill("Free returns for 30 days");
  await page.getByRole("button", { name: "Add a slide" }).click();
  await page.getByLabel("Seconds each slide shows").fill("3");
  const show = preview.getByRole("region", { name: "Slideshow" });
  await show.scrollIntoViewIfNeeded();
  // The third slide is still empty, so only two have dots.
  await expect(show.getByRole("button", { name: /^Show slide/ })).toHaveCount(2);
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  await buyerContext.route(PIC, (r) => r.fulfill({ contentType: "image/svg+xml", body: SVG }));
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "Slideshow" });
  await live.scrollIntoViewIfNeeded();
  const first = live.getByRole("group", { name: "1 of 2" });
  const second = live.getByRole("group", { name: "2 of 2" });
  await expect(first.getByRole("heading", { name: "Summer is here" })).toBeVisible();
  await expect(first).not.toHaveAttribute("inert");
  await expect(second).toHaveAttribute("inert");
  // The slideshow holds still under the pointer, so point just above or below it.
  const box = (await live.boundingBox())!;
  const away = async () => buyer.mouse.move(box.x + 5, box.y > 10 ? box.y - 5 : box.y + box.height + 5);

  // It moves on by itself while the pointer is elsewhere.
  await away();
  await expect(live.getByRole("button", { name: "Show slide 2" })).toHaveAttribute("aria-current", "true", { timeout: 8000 });
  await expect(second).not.toHaveAttribute("inert");

  // Pausing stops it; the arrows and dots still work.
  await live.getByRole("button", { name: "Pause the slideshow" }).click();
  await expect(live.getByRole("button", { name: "Play the slideshow" })).toBeVisible();
  await live.getByRole("button", { name: "Next slide" }).click();
  await expect(live.getByRole("button", { name: "Show slide 1" })).toHaveAttribute("aria-current", "true");
  await away();
  await buyer.waitForTimeout(3500);
  await expect(live.getByRole("button", { name: "Show slide 1" })).toHaveAttribute("aria-current", "true");
  await live.getByRole("link", { name: "Shop summer" }).click();
  await expect(buyer).toHaveURL(new RegExp(`/s/${handle}/collections/all`));
  await buyerContext.close();
});
