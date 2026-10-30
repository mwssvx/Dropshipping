import { expect, test, type Page } from "@playwright/test";

// The theme editor's Style tab can make product cards show a product's second photo while a
// shopper points at them. Phones have no pointer to hover, so they keep the main photo.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png` });
};

const png = (b64: string, name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
const ORANGE = png("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP4NNOLJMQwqmFUw/DVAAD9ItUQ1CpVsgAAAABJRU5ErkJggg==", "orange.png");
const BLUE = png("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGMIq9hHEmIY1TCqYfhqAAAekowQ1ZAHyAAAAABJRU5ErkJggg==", "blue.png");

test("a merchant shows a product's second photo when shoppers point at its card", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`hover-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Hover ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Hover/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
  const photos = page.getByRole("region", { name: "Photos" });
  for (const file of [ORANGE, BLUE]) {
    await photos.getByLabel("Upload a photo").setInputFiles(file);
    await photos.getByRole("button", { name: "Add photo" }).click();
    await expect(photos.getByText("Photo added.")).toBeVisible();
  }
  await expect(photos.getByRole("img")).toHaveCount(2);
  const second = await photos.getByRole("img", { name: /photo 2$/ }).getAttribute("src");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${store}/collections/all`);
  const card = buyer.getByRole("link", { name: /Sunset Projection Lamp/ }).first();
  const extra = card.locator(".sf-hover-photo");
  // Off at first: the second photo isn't on the page at all.
  await expect(extra).toHaveAttribute("src", second!);
  await expect(extra).toBeHidden();

  await page.goto("/admin/theme");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Show a product’s second photo when shoppers point at its card").check();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await buyer.reload();
  if (info.project.name === "phone") {
    // No hover on a touch screen, so nothing extra loads.
    await expect(extra).toBeHidden();
    return;
  }
  await expect(extra).toHaveCSS("opacity", "0");
  await card.hover();
  await expect(extra).toHaveCSS("opacity", "1");
  await shot(buyer, "hover-photo");
  await buyer.mouse.move(0, 0);
  await expect(extra).toHaveCSS("opacity", "0");
  // Screen readers still hear the product's name once, from the main photo and title.
  await expect(card.getByRole("img")).toHaveCount(1);
});
