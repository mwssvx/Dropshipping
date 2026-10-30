import { expect, test, type Page } from "@playwright/test";

// The theme editor's Style tab can keep the store's header on screen while shoppers scroll.

async function scrolledHeader(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.scrollY > 300);
  return page.getByRole("banner");
}

test("a merchant keeps the header on screen while shoppers scroll", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sticky-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sticky ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sticky/ })).toBeVisible();
  const handle = `sticky-${id}`.toLowerCase();

  // A short screen, so the home page scrolls.
  const buyerContext = await browser.newContext({ ...info.project.use, viewport: { width: info.project.name === "phone" ? 390 : 1280, height: 420 } });
  const buyer = await buyerContext.newPage();
  // Off at first: the header scrolls away.
  await expect(await scrolledHeader(buyer, `/s/${handle}`)).not.toBeInViewport();

  await page.goto("/admin/theme");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Keep the header on screen while shoppers scroll").check();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const header = await scrolledHeader(buyer, `/s/${handle}`);
  await expect(header).toBeInViewport();
  expect((await header.boundingBox())!.y).toBeLessThanOrEqual(1);
  await expect(header.getByRole("link", { name: /^Cart/ })).toBeVisible();
  await buyerContext.close();
});
