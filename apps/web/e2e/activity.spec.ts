import { expect, test, type Page } from "@playwright/test";

// The team activity log: what people on the store did, newest first, each linking to what changed.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the activity page shows who did what", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const email = `act-${id}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Act ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Act/ })).toBeVisible();

  await page.goto("/admin/activity");
  await expect(page.getByText("Nothing yet.")).toBeVisible();

  // A product imported and edited, the plan changed and someone invited.
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  await page.locator("#price-0").fill("15.99");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const productPath = new URL(page.url()).pathname;
  await page.goto("/admin/plan");
  await page.getByRole("button", { name: "Upgrade to Scale" }).click();
  await expect(page.getByRole("heading", { name: "You're on Scale" })).toBeVisible();
  await page.goto("/admin/team");
  await page.getByRole("textbox", { name: "Email" }).fill(`helper-${id}@example.com`);
  await page.getByLabel("Role", { exact: true }).selectOption("staff");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toContainText("Invite sent");

  await page.goto("/admin/activity");
  const items = page.getByRole("main").getByRole("listitem");
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText(`${email} invited helper-${id}@example.com as staff`);
  await expect(items.nth(1)).toContainText(`${email} changed the plan to Scale`);
  await expect(items.nth(2)).toContainText(`${email} edited the product “Sunset Projection Lamp”`);
  await expect(items.nth(3)).toContainText(`${email} imported the product “Sunset Projection Lamp” from a supplier`);
  await shot(page, "400-activity");
  await items.nth(2).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`${productPath}$`));
});
