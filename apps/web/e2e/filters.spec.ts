import { expect, test, type Page } from "@playwright/test";

// Filters on collection and search pages: options the products come in (sizes from the supplier),
// and what's on sale. Plain GET forms, so a filtered page has its own address to share.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("buyers narrow a collection by size and by what's on sale", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`fi-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sizes ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sizes/ })).toBeVisible();
  // The lamp comes in Small and Large; the phone stand in one size.
  let store = "";
  let stand = "";
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    store ||= (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
    stand = page.url();
  }
  // Put the stand on sale.
  await page.goto(stand);
  const price = await page.getByLabel("Price", { exact: true }).first().inputValue();
  await page.getByLabel("Compare-at price").first().fill(String(Number(price) + 5));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/^Saved\./).first()).toBeVisible();

  await page.goto(`${store}/collections/all`);
  const main = page.getByRole("main");
  await expect(main.getByRole("listitem")).toHaveCount(2);
  await main.locator("summary", { hasText: "Size" }).click();
  await page.getByRole("checkbox", { name: /^Large/ }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/opt=Size%3ALarge/);
  await expect(main.getByRole("listitem")).toHaveCount(1);
  await expect(main.getByRole("link", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await expect(page.getByText("Size (1)")).toBeVisible();
  await shot(page, "171-filter-size");

  await page.getByRole("checkbox", { name: /^Large/ }).uncheck();
  await page.getByLabel("On sale").check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(main.getByRole("listitem")).toHaveCount(1);
  await expect(main.getByRole("link", { name: /Magnetic Phone Stand/ })).toBeVisible();

  // Both at once: nothing is a large stand.
  await main.locator("summary", { hasText: "Size" }).click();
  await page.getByRole("checkbox", { name: /^Large/ }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Nothing matches those filters.")).toBeVisible();
});
