import { expect, test, type Page } from "@playwright/test";

// Sold-out products: lists show what can be bought first, or leave sold-out products out, while
// their own pages keep working.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

/** The products a store page lists, in order, by their address. */
const listed = (p: Page) =>
  p.locator('main a[href*="/products/"]').evaluateAll((links) => [...new Set(links.map((a) => new URL((a as HTMLAnchorElement).href).pathname))]);

test("sold-out products go last, or are hidden, in the store's lists", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`out-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Out ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Out/ })).toBeVisible();

  const links: string[] = [];
  for (const name of [/sunset projection lamp/i, /galaxy projector low stock/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    links.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
    if (links.length === 1) {
      // The lamp sells out, both sizes.
      await page.locator("#stock-0").fill("0");
      await page.locator("#stock-1").fill("0");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Saved.")).toBeVisible();
    }
  }
  const [lamp, projector] = links.map((l) => new URL(l, "http://x").pathname) as [string, string];
  const home = lamp.replace(/\/products\/.*$/, "");

  // By default it goes after what can be bought.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${home}/collections/all`);
  await expect.poll(() => listed(buyer)).toEqual([projector, lamp]);
  await buyer.goto(`${home}/collections/all?sort=newest`);
  await expect.poll(() => listed(buyer)).toEqual([projector, lamp]);

  // Hidden: gone from lists and search, but its page still works.
  await page.goto("/admin/products");
  const section = page.getByRole("region", { name: "Sold-out products" });
  await expect(section.getByRole("radio", { name: /^After everything that can be bought/ })).toBeChecked();
  await section.getByRole("radio", { name: /^Hidden/ }).check();
  await section.getByRole("button", { name: "Save sold-out setting" }).click();
  await expect(section.getByText("Saved. Your store's lists follow it now.")).toBeVisible();
  await shot(page, "391-sold-out-setting");
  await buyer.goto(`${home}/collections/all`);
  await expect.poll(() => listed(buyer)).toEqual([projector]);
  await buyer.goto(`${home}/search?q=lamp`);
  await expect.poll(() => listed(buyer)).not.toContain(lamp);
  await buyer.goto(lamp);
  await expect(buyer.getByRole("heading", { name: "Sunset Projection Lamp" })).toBeVisible();

  // Where they are: back in the list.
  await page.reload();
  await section.getByRole("radio", { name: /^Where they are/ }).check();
  await section.getByRole("button", { name: "Save sold-out setting" }).click();
  await expect(section.getByText("Saved. Your store's lists follow it now.")).toBeVisible();
  await buyer.goto(`${home}/collections/all`);
  await expect.poll(async () => (await listed(buyer)).sort()).toEqual([lamp, projector].sort());
});
