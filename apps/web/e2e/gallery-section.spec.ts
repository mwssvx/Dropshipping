import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The home page's photo gallery: square photos in a grid, each with an optional link, and a
// button like "Follow us". A photo with no picture yet stays hidden.

const PIC = (n: number) => `https://images.example.com/look-${n}.svg`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#c96"/></svg>';

test("a merchant adds a photo gallery that links to their Instagram", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  // Serve the photos from the test so it doesn't depend on the network.
  await page.context().route("https://images.example.com/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: SVG }));
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`gallery-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Gallery ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Gallery/ })).toBeVisible();
  const handle = `gallery-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("gallery");
  await page.getByLabel("Heading (optional)").fill("Follow us on Instagram");
  for (const n of [1, 2, 3]) {
    await page.getByRole("button", { name: "Add a photo" }).click();
    if (n === 3) break;
    await page.getByLabel(`Photo ${n}`, { exact: true }).fill(PIC(n));
  }
  await page.getByLabel("What the photo shows 1").fill("The lamp on a bedside table");
  await page.getByLabel("Photo link 1").fill("https://www.instagram.com/p/abc");
  await page.getByLabel("Button label").fill("Follow us");
  await page.getByLabel("Button link").fill("https://www.instagram.com/yourstore");
  const grid = preview.getByRole("region", { name: "Follow us on Instagram" });
  await grid.scrollIntoViewIfNeeded();
  // The third photo has no picture yet, so only two show.
  await expect(grid.getByRole("listitem")).toHaveCount(2);
  await expect(grid.getByRole("link", { name: "The lamp on a bedside table" })).toHaveAttribute("href", "https://www.instagram.com/p/abc");
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  await buyerContext.route("https://images.example.com/**", (r) => r.fulfill({ contentType: "image/svg+xml", body: SVG }));
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "Follow us on Instagram" });
  await live.scrollIntoViewIfNeeded();
  await expect(live.locator("img")).toHaveCount(2);
  await expect(live.getByRole("link", { name: "The lamp on a bedside table" })).toBeVisible();
  await expect(live.getByRole("link", { name: "Follow us" })).toHaveAttribute("href", "https://www.instagram.com/yourstore");
  const result = await new AxeBuilder({ page: buyer }).include(".sf-gallery").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await buyerContext.close();
});
