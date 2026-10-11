import { expect, test, type Page } from "@playwright/test";

// "Only N left": product pages say how many are left of an option that's running low, from the
// real stock count. The merchant picks the number, or turns it off.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("an option running low says how many are left", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`few-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Few ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Few/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // Plenty of stock: nothing to say.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByText(/^Only \d+ left$/)).toHaveCount(0);

  // The small one runs low.
  await expect(page.locator("#stock-0")).toHaveValue(/^\d+$/);
  await page.locator("#stock-0").fill("3");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await buyer.reload();
  await expect(buyer.getByText("Only 3 left")).toBeVisible();
  await shot(buyer, "351-low-stock-product");
  // The large one has plenty.
  await buyer.getByText("Large", { exact: true }).click();
  await expect(buyer.getByText("Only 3 left")).toHaveCount(0);

  // The merchant turns it off.
  await page.goto("/admin/products");
  const section = page.getByRole("region", { name: "Few left" });
  await expect(section.getByLabel("Say how many are left at")).toHaveValue("5");
  // Past the box's own limit (the browser would stop it), the server says so too.
  await section.getByLabel("Say how many are left at").evaluate((el) => ((el as HTMLInputElement).max = "", (el as HTMLInputElement).value = "60"));
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("alert")).toContainText("Pick a number from 0 to 50.");
  await section.getByLabel("Say how many are left at").fill("0");
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByText("Saved. Product pages don't say how many are left.")).toBeVisible();
  await shot(page, "352-low-stock-settings");
  await buyer.reload();
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByText("Only 3 left")).toHaveCount(0);
});
