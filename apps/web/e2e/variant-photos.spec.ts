import { expect, test, type Page } from "@playwright/test";

// Variant photos: each colour gets its own photo, and picking a colour on the store shows it.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

const COVER = "https://img.example.com/mug-cover.jpg";
const RED = "https://img.example.com/mug-red.jpg";
const BLUE = "https://img.example.com/mug-blue.jpg";

test("picking a colour shows its photo on the store and in the cart", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`vp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Mugs ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Mugs/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Enamel Mug");
  await page.getByLabel("Price", { exact: true }).fill("18.00");
  await page.getByRole("button", { name: "Add options like size or colour" }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Color");
  await page.getByLabel("Option 1 values, separated by commas").fill("Red, Blue");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  const photos = page.getByRole("region", { name: "Photos" });
  for (const url of [COVER, RED, BLUE]) {
    await photos.getByLabel("Or paste its address").fill(url);
    await photos.getByRole("button", { name: "Add photo" }).click();
    await expect(photos.getByRole("img", { name: /photo \d$/ })).toHaveCount([COVER, RED, BLUE].indexOf(url) + 1);
  }

  const perColor = page.getByRole("region", { name: "Photo for each color" });
  await perColor.getByRole("radio", { name: "Red: photo 2" }).check({ force: true });
  await perColor.getByRole("radio", { name: "Blue: photo 3" }).check({ force: true });
  await perColor.getByRole("button", { name: "Save photos" }).click();
  await expect(perColor.getByText("Saved. Buyers see that photo when they pick it.")).toBeVisible();
  await expect(perColor.getByRole("radio", { name: "Blue: photo 3" })).toBeChecked();
  await shot(page, "211-variant-photos");

  // On the store the cover shows first; picking Blue switches to the blue photo.
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  await page.goto(store);
  const main = page.getByRole("img", { name: /^Enamel Mug, photo \d of 3$/ });
  await expect(main).toHaveAttribute("src", COVER);
  const color = page.getByRole("group", { name: /^Color:/ });
  await color.getByText("Blue", { exact: true }).click();
  await expect(color).toHaveAccessibleName("Color: Blue");
  await expect(main).toHaveAttribute("src", BLUE);
  await color.getByText("Red", { exact: true }).click();
  await expect(main).toHaveAttribute("src", RED);
  await color.getByText("Blue", { exact: true }).click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await page.goto(store.replace(/\/products\/.*$/, "/cart"));
  await expect(page.getByText("Enamel Mug – Blue")).toBeVisible();
  await expect(page.locator(`img[src="${BLUE}"]`)).toHaveCount(1);
});
