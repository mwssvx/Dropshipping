import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Bigger photos: pressing the large product photo opens it full screen, where buyers step through
// the photos with buttons, arrow keys or a swipe, zoom in, and close it again.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png` });
};

const png = (b64: string, name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
const ORANGE = png("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP4NNOLJMQwqmFUw/DVAAD9ItUQ1CpVsgAAAABJRU5ErkJggg==", "orange.png");
const BLUE = png("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGMIq9hHEmIY1TCqYfhqAAAekowQ1ZAHyAAAAABJRU5ErkJggg==", "blue.png");

test("a buyer opens a product's photos full screen, steps through them and zooms in", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`viewer-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Viewer ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Viewer/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const storeLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const photos = page.getByRole("region", { name: "Photos" });
  await photos.getByLabel("Upload a photo").setInputFiles(ORANGE);
  await photos.getByRole("button", { name: "Add photo" }).click();
  await expect(photos.getByText("Photo added.")).toBeVisible();
  await photos.getByLabel("Upload a photo").setInputFiles(BLUE);
  await photos.getByRole("button", { name: "Add photo" }).click();
  await expect(photos.getByRole("img")).toHaveCount(2);

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(storeLink);
  // The photo keeps its description; the button over it opens the full-screen view.
  await expect(buyer.getByRole("img", { name: /photo 1 of 2/ })).toBeVisible();
  const opener = buyer.getByRole("button", { name: "Open a larger photo" });
  const viewer = buyer.getByRole("dialog", { name: "Sunset Projection Lamp" });
  await expect(viewer).toHaveCount(0);
  // Pressing it before the page is ready does nothing, so retry until the view opens.
  await expect(async () => {
    await opener.click();
    await expect(viewer).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(viewer.getByText("Photo 1 of 2")).toBeVisible();
  await expect(viewer.getByRole("img", { name: /photo 1 of 2/ })).toBeVisible();

  await viewer.getByRole("button", { name: "Next photo" }).click();
  await expect(viewer.getByText("Photo 2 of 2")).toBeVisible();
  await buyer.keyboard.press("ArrowRight");
  await expect(viewer.getByText("Photo 1 of 2")).toBeVisible();
  await buyer.keyboard.press("ArrowLeft");
  await expect(viewer.getByText("Photo 2 of 2")).toBeVisible();
  await viewer.getByRole("button", { name: "Previous photo" }).click();
  await expect(viewer.getByText("Photo 1 of 2")).toBeVisible();

  // Zooming in and out.
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.getByRole("button", { name: "Zoom out" })).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByRole("img")).toHaveAttribute("style", /scale\(2\.5\)/);
  await shot(buyer, "photo-viewer-zoomed");
  await viewer.getByRole("button", { name: "Zoom out" }).click();
  await expect(viewer.getByRole("img")).not.toHaveAttribute("style", /scale/);

  // A swipe to the left shows the next photo.
  const box = (await viewer.getByRole("img").boundingBox())!;
  const y = box.y + box.height / 2;
  await buyer.mouse.move(box.x + box.width * 0.8, y);
  await buyer.mouse.down();
  await buyer.mouse.move(box.x + box.width * 0.2, y, { steps: 5 });
  await buyer.mouse.up();
  await expect(viewer.getByText("Photo 2 of 2")).toBeVisible();
  // A swipe is not a press, so the photo is not zoomed.
  await expect(viewer.getByRole("img")).not.toHaveAttribute("style", /scale/);
  await shot(buyer, "photo-viewer");

  const results = await new AxeBuilder({ page: buyer }).include("dialog").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  // Escape closes it, and the page shows the photo the buyer stopped on.
  await buyer.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(buyer.getByRole("img", { name: /photo 2 of 2/ })).toBeVisible();
  await opener.click();
  await viewer.getByRole("button", { name: "Close the photos" }).click();
  await expect(viewer).toHaveCount(0);
  await expect(opener).toBeFocused();
});
