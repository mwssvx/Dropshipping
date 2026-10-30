import { expect, test, type Page } from "@playwright/test";

// Store search: a search box on every store, and sorting and price filters on search results and
// collection pages. Plain links and GET forms, so every result page has its own address.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchantWithProducts(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`se-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Finder ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Finder/ })).toBeVisible();
  let lamp = "";
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    lamp ||= (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }
  return lamp.replace(/\/products\/.*$/, "");
}

const prices = async (page: Page) =>
  (await page.getByRole("main").getByRole("listitem").allTextContents()).map((t) => Number(t.match(/\$([\d.]+)/)![1]));

test("buyers search the store, then sort and filter the results", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const store = await newMerchantWithProducts(page, id);
  await page.goto(store);
  // The header's search button opens a search box on the page the shopper is on.
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Search" })).toBeFocused();
  await page.getByRole("combobox", { name: "Search" }).fill("lamps");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Results for “lamps”" })).toBeVisible();
  await expect(page.getByText("1 product", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await expect(page.getByLabel("Sort by").locator("option:checked")).toHaveText("Best match");
  await expect(page.getByRole("link", { name: /Magnetic Phone Stand/ })).toHaveCount(0);
  await shot(page, "111-search-results");

  await page.getByRole("combobox", { name: "Search" }).fill("teapot");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Nothing matches “teapot”")).toBeVisible();
  await page.getByRole("link", { name: "see everything" }).click();

  // All products: sort by price both ways, then cap the price.
  await expect(page.getByRole("heading", { name: "All products" })).toBeVisible();
  await page.getByLabel("Sort by").selectOption({ label: "Price, low to high" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/sort=price_asc/);
  // The form is a plain GET: wait for the new page to finish loading before filling it again, or
  // the typed price can land in the page that's being replaced.
  await page.waitForLoadState("load");
  const up = await prices(page);
  expect(up).toEqual([...up].sort((a, b) => a - b));
  await page.getByLabel("Sort by").selectOption({ label: "Price, high to low" });
  await page.getByLabel("Highest price").fill(String(up[0]));
  await page.getByLabel("In stock only").check();
  await expect(page.getByLabel("Highest price")).toHaveValue(String(up[0]));
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/max=/);
  await expect(page.getByText("1 product", { exact: true })).toBeVisible();
  expect(await prices(page)).toEqual([up[0]]);
  await shot(page, "112-collection-sorted");
  await page.getByLabel("Highest price").fill("0.50");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Nothing matches those filters.")).toBeVisible();
});

test("the search box suggests products as the buyer types", async ({ page }, info) => {
  const id = `${info.project.name}-sg-${Date.now()}`;
  const store = await newMerchantWithProducts(page, id);
  await page.goto(`${store}/search`);
  const box = page.getByRole("combobox", { name: "Search" });
  await box.pressSequentially("proj");
  const list = page.getByRole("listbox", { name: "Suggestions" });
  await expect(list.getByRole("option")).toHaveText([/^Sunset Projection Lamp\$\d+\.\d{2}/, "See all results for “proj”"]);
  await shot(page, "401-search-suggestions");

  // Escape closes them; the arrow keys and Enter open the picked product.
  await box.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(box).toHaveValue("proj");
  await box.pressSequentially("ection");
  await expect(list.getByRole("option").first()).toContainText("Sunset Projection Lamp");
  await box.press("ArrowDown");
  await expect(list.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(page).toHaveURL(/\/products\/sunset-projection-lamp/);

  // The last row runs the whole search.
  await page.goto(`${store}/search`);
  await page.getByRole("combobox", { name: "Search" }).pressSequentially("stand");
  await page.getByRole("option", { name: "See all results for “stand”" }).click();
  await expect(page.getByRole("heading", { name: "Results for “stand”" })).toBeVisible();
});
