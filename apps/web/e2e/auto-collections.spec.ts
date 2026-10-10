import { expect, test, type Page } from "@playwright/test";

// Automatic collections: the merchant sets rules once, sees which products match while typing, and
// the store page fills itself.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a collection fills itself by rules", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ac-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Rules ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Rules/ })).toBeVisible();
  let store = "";
  for (const name of [/magnetic phone stand/i, /sunset projection lamp/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
  }

  await page.goto("/admin/collections/new");
  await page.getByLabel("Title").fill("Lamps and light");
  await page.getByLabel(/By rules/).check();
  const rules = page.getByRole("region", { name: "Rules" });
  await expect(rules.getByText("Fill in a condition to see which products match.")).toBeVisible();
  await rules.getByLabel("Word 1").fill("lamp");
  await expect(rules.getByRole("heading", { name: "1 product matches now" })).toBeVisible();
  await expect(rules.getByRole("list", { name: "Matching products" })).toContainText("Sunset Projection Lamp");

  // A second condition that any product can meet instead.
  await rules.getByRole("button", { name: "Add condition" }).click();
  await rules.getByLabel("Condition 2").selectOption({ label: "Price is at most" });
  await rules.getByLabel("Price 2").fill("cheap");
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByRole("alert")).toContainText("Condition 2: enter a price like 30.00.");
  await rules.getByLabel("Price 2").fill("1000");
  await rules.getByLabel("Products must meet").selectOption({ label: "Any one condition" });
  await expect(rules.getByRole("heading", { name: "2 products match now" })).toBeVisible();
  await rules.getByLabel("Show them").selectOption({ label: "A to Z" });
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Rules" }).getByLabel("Word 1")).toHaveValue("lamp");
  await shot(page, "270-collection-rules");

  await page.goto("/admin/collections");
  await expect(page.getByRole("row", { name: /Lamps and light/ })).toContainText("By rules");
  await expect(page.getByRole("row", { name: /Lamps and light/ })).toContainText("2");

  await page.goto(`${store}/collections/lamps-and-light`);
  await expect(page.getByRole("heading", { name: "Lamps and light" })).toBeVisible();
  const links = page.getByRole("main").getByRole("link", { name: /Magnetic Phone Stand|Sunset Projection Lamp/ });
  await expect(links).toHaveCount(2);
  await expect(links.first()).toContainText("Magnetic Phone Stand");
});
