import { expect, test, type Page } from "@playwright/test";

// The lowest earlier price: a reduced price says what the lowest price was in the 30 days before
// the reduction, as the EU asks. Worked out from the real price history, never typed in.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a reduced price shows the lowest price of the 30 days before it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`low-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Low ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Low/ })).toBeVisible();

  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const link = new URL((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, "http://x").pathname;

  // The small lamp goes from $13.99 down to $9.99.
  await page.locator("#price-0").fill("9.99");
  await page.locator("#compareAt-0").fill("13.99");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // By default only visitors in Europe see it; the test browser has no country.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(link);
  await expect(buyer.getByText("$9.99").first()).toBeVisible();
  await expect(buyer.getByText(/Lowest price in the 30 days before/)).toHaveCount(0);

  await page.goto("/admin/sales");
  const section = page.getByRole("region", { name: "Lowest earlier price" });
  await expect(section.getByRole("radio", { name: /^Visitors in Europe/ })).toBeChecked();
  await section.getByRole("radio", { name: /^Everyone/ }).check();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByText("Saved. Product pages follow it now.")).toBeVisible();
  await shot(page, "395-lowest-price-setting");

  await buyer.reload();
  const note = buyer.getByText(/Lowest price in the 30 days before this discount:/).first();
  await expect(note).toBeVisible();
  await expect(note).toContainText("$13.99");
  await shot(buyer, "396-lowest-price-note");

  // Nobody: the note goes away.
  await section.getByRole("radio", { name: /^Nobody/ }).check();
  await section.getByRole("button", { name: "Save" }).click();
  await expect(async () => {
    await buyer.reload();
    await expect(buyer.getByText(/Lowest price in the 30 days before/)).toHaveCount(0, { timeout: 1000 });
  }).toPass();
});
