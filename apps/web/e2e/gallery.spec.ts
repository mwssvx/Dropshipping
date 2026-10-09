import { expect, test, type Page } from "@playwright/test";

// Product photos: the merchant uploads several, picks the main one and orders them; buyers flip
// through them on the product page.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const png = (b64: string, name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
const ORANGE = png("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP4NNOLJMQwqmFUw/DVAAD9ItUQ1CpVsgAAAABJRU5ErkJggg==", "orange.png");
const BLUE = png("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGMIq9hHEmIY1TCqYfhqAAAekowQ1ZAHyAAAAABJRU5ErkJggg==", "blue.png");

test("a merchant adds and orders photos, and buyers flip through them", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ph-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Photos ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Photos/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const storeLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const photos = page.getByRole("region", { name: "Photos" });
  await expect(photos.getByText("No photos yet.")).toBeVisible();
  await photos.getByLabel("Or paste its address").fill("http://insecure.example.com/lamp.jpg");
  await photos.getByRole("button", { name: "Add photo" }).click();
  await expect(photos.getByRole("alert")).toContainText("https");
  await expect(photos.getByLabel("Or paste its address")).toHaveValue("http://insecure.example.com/lamp.jpg");
  await photos.getByLabel("Or paste its address").fill("");

  await photos.getByLabel("Upload a photo").setInputFiles(ORANGE);
  await photos.getByRole("button", { name: "Add photo" }).click();
  await expect(photos.getByText("Photo added.")).toBeVisible();
  await photos.getByLabel("Upload a photo").setInputFiles(BLUE);
  await photos.getByRole("button", { name: "Add photo" }).click();
  await expect(photos.getByRole("img")).toHaveCount(2);
  const orangeSrc = await photos.getByRole("img", { name: /photo 1$/ }).getAttribute("src");

  // The blue one becomes the main photo.
  await photos.getByRole("button", { name: "Make photo 2 the main photo" }).click();
  await expect(photos.getByText("That's the main photo now.")).toBeVisible();
  await expect(photos.getByRole("img", { name: /photo 2$/ })).toHaveAttribute("src", orangeSrc!);
  await shot(page, "122-product-photos");

  // Buyers see the main photo first and can switch.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(storeLink);
  await expect(buyer.getByRole("img", { name: /photo 1 of 2/ })).toBeVisible();
  await buyer.getByRole("button", { name: "Show photo 2" }).click();
  await expect(buyer.getByRole("img", { name: /photo 2 of 2/ })).toHaveAttribute("src", orangeSrc!);
  await shot(buyer, "123-store-gallery");

  // Removing one leaves a single photo and no thumbnails.
  await photos.getByRole("button", { name: "Remove photo 1" }).click();
  await expect(photos.getByText("Photo removed.")).toBeVisible();
  await expect(photos.getByRole("img")).toHaveCount(1);
  await buyer.reload();
  await expect(buyer.getByRole("button", { name: "Show photo 1" })).toHaveCount(0);
  await expect(buyer.getByRole("img", { name: "Sunset Projection Lamp", exact: true })).toHaveAttribute("src", orangeSrc!);
});
