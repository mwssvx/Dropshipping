import { expect, test, type Page } from "@playwright/test";

// Photo descriptions: the merchant says what each photo shows; the store reads it out to screen
// readers and gives it to image search, and the Search listings page points out photos without one.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const png = (b64: string, name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
const ORANGE = png("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP4NNOLJMQwqmFUw/DVAAD9ItUQ1CpVsgAAAABJRU5ErkJggg==", "orange.png");
const BLUE = png("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGMIq9hHEmIY1TCqYfhqAAAekowQ1ZAHyAAAAABJRU5ErkJggg==", "blue.png");

test("a merchant describes product photos and buyers' screen readers hear it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`alt-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Alt ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Alt/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const storeLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const photos = page.getByRole("region", { name: "Photos" });
  await expect(photos.getByRole("form", { name: "Describe each photo" })).toHaveCount(0);
  for (const file of [ORANGE, BLUE]) {
    await photos.getByLabel("Upload a photo").setInputFiles(file);
    await photos.getByRole("button", { name: "Add photo" }).click();
    await expect(photos.getByText("Photo added.")).toBeVisible();
  }
  const describe = photos.getByRole("form", { name: "Describe each photo" });
  await expect(describe.getByLabel("Photo 2")).toBeVisible();

  // The Search listings page points out both photos.
  await page.goto("/admin/seo");
  const missing = page.getByRole("region", { name: "Photos with no description" });
  await expect(missing.getByRole("listitem")).toHaveText("Sunset Projection Lamp (2 photos)");
  await missing.getByRole("link", { name: "Sunset Projection Lamp" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}#photos-heading$/);

  // Too long is turned back, keeping what was typed.
  const first = describe.getByLabel("Photo 1 (main)");
  await first.evaluate((el) => el.removeAttribute("maxlength"));
  await first.fill("A".repeat(130));
  await describe.getByRole("button", { name: "Save descriptions" }).click();
  await expect(describe.getByText("Keep each description to 125 characters. Photo 1 is 130.")).toBeVisible();
  await expect(first).toHaveValue("A".repeat(130));

  await first.fill("Sunset lamp casting an orange glow on a bedroom wall");
  await describe.getByRole("button", { name: "Save descriptions" }).click();
  await expect(describe.getByText("Saved. 1 of 2 photos have a description.")).toBeVisible();
  await expect(photos.getByRole("img", { name: "Sunset lamp casting an orange glow on a bedroom wall" })).toBeVisible();
  await shot(page, "371-photo-descriptions");

  // Buyers' screen readers hear the description; the photo without one is named after the product.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(storeLink);
  await expect(buyer.getByRole("img", { name: "Sunset lamp casting an orange glow on a bedroom wall" })).toBeVisible();
  await buyer.getByRole("button", { name: "Show photo 2" }).click();
  await expect(buyer.getByRole("img", { name: "Sunset Projection Lamp, photo 2 of 2" })).toBeVisible();

  // Describing the second clears the product off the list.
  await describe.getByLabel("Photo 2").fill("The lamp switched off, next to its box");
  await describe.getByRole("button", { name: "Save descriptions" }).click();
  await expect(describe.getByText("Saved. Every photo has a description.")).toBeVisible();
  await page.goto("/admin/seo");
  await expect(page.getByRole("region", { name: "Photos with no description" })).toHaveCount(0);
  await buyer.reload();
  await buyer.getByRole("button", { name: "Show photo 2" }).click();
  await expect(buyer.getByRole("img", { name: "The lamp switched off, next to its box" })).toBeVisible();
});
