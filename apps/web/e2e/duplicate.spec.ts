import { expect, test, type Page } from "@playwright/test";

// Duplicate a product: a copy to start the next listing from, kept as a draft until it's ready.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant copies a product and changes what's different", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`dup-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Mugs ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Mugs/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Blue Mug");
  await page.getByLabel("Price", { exact: true }).fill("18.00");
  await page.getByLabel("Stock").fill("12");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: "Copy of Blue Mug", level: 1 })).toBeVisible();
  await expect(page.getByText("This is a copy, saved as a draft")).toBeVisible();
  await expect(page.getByText("Its stock starts at 0")).toBeVisible();
  await expect(page.getByLabel("Price", { exact: true })).toHaveValue("18.00");
  await expect(page.getByLabel("Stock")).toHaveValue("0");
  await shot(page, "394-duplicated-product");

  await page.getByLabel("Title").fill("Green Mug");
  await page.getByLabel("Stock").fill("5");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/^Saved\./).first()).toBeVisible();

  await page.goto("/admin/products");
  await expect(page.getByRole("link", { name: "Blue Mug" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Green Mug" })).toBeVisible();
  await page.goto("/admin/activity");
  await expect(page.getByText("Duplicated a product as “Copy of Blue Mug”")).toBeVisible();
});
