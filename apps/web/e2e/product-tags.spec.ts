import { expect, test, type Page } from "@playwright/test";

// Product tags: the merchant tags products, finds them by tag, and makes a collection that fills
// itself with a tag.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant tags products and fills a collection by tag", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pt-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Tagged ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Tagged/ })).toBeVisible();

  let store = "";
  for (const [title, tags] of [["Straw Sun Hat", "Summer, gift idea"], ["Beach Towel", "summer"], ["Wool Scarf", "winter"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("20.00");
    await page.getByLabel("Tags", { exact: true }).fill(tags);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
  }
  // Saved cleaned up, and kept on the next save.
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValue("winter");

  // The product list filters by tag.
  await page.goto("/admin/products");
  const tags = page.getByRole("navigation", { name: "Filter by tag" });
  await expect(tags.getByRole("link")).toHaveText([/summer\s*2/, /gift idea\s*1/, /winter\s*1/]);
  await tags.getByRole("link", { name: /summer/ }).click();
  await expect(page).toHaveURL(/tag=summer/);
  await expect(page.getByRole("row").filter({ hasText: "Straw Sun Hat" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Beach Towel" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Wool Scarf" })).toHaveCount(0);
  await shot(page, "415-products-by-tag");

  // A collection that fills itself with the tag.
  await page.goto("/admin/collections/new");
  await page.getByLabel("Title").fill("Summer things");
  await page.getByLabel(/By rules/).check();
  const rules = page.getByRole("region", { name: "Rules" });
  await rules.getByLabel("Condition 1", { exact: true }).selectOption({ label: "Is tagged" });
  await rules.getByLabel("Tag 1").fill("Summer");
  await expect(rules.getByRole("heading", { name: "2 products match now" })).toBeVisible();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto(`${store}/collections/summer-things`);
  await expect(page.getByRole("heading", { name: "Summer things" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: /Straw Sun Hat|Beach Towel|Wool Scarf/ })).toHaveCount(2);
});
