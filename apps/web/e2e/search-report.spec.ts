import { expect, test, type Page } from "@playwright/test";

// What shoppers search for: searches on the store show on the Analytics page, with the ones
// that found nothing listed apart.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("searches on the store show on the Analytics page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`srch-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Search ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Search/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const home = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");

  await page.goto("/admin/analytics");
  const section = page.getByRole("region", { name: "What shoppers search for" });
  await expect(section.getByText("Only the words are kept, never who searched.", { exact: false })).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  for (const q of ["Lamp", "lamp", "lamp shade", "me@example.com"]) {
    await buyer.goto(`${home}/search?q=${encodeURIComponent(q)}`);
    await expect(buyer.getByRole("heading", { level: 1 })).toBeVisible();
  }
  // Sorting a search isn't another search.
  await buyer.goto(`${home}/search?q=lamp&sort=price_asc`);

  await expect(async () => {
    await page.reload();
    await expect(section.getByText("3 searches, 33% found nothing")).toBeVisible({ timeout: 1000 });
  }).toPass();
  const top = section.getByRole("list", { name: "Most searched" });
  await expect(top.getByRole("listitem")).toHaveText(["lamp2 · 1 result", "lamp shade1 · 0 results"]);
  const nothing = section.getByRole("list", { name: "Found nothing" });
  await expect(nothing.getByRole("listitem")).toHaveText(["lamp shade1 search"]);
  await expect(nothing.getByRole("link", { name: "lamp shade" })).toHaveAttribute("href", /\/search\?q=lamp%20shade$/);
  await expect(section).not.toContainText("example.com");
  await shot(page, "401-search-report");
});
