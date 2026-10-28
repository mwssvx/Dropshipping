import { expect, test, type Page } from "@playwright/test";

// The store review: the business analyst reads the store's numbers and leaves a few suggestions,
// each linking to where in the admin to act on it.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test("the business analyst reviews the store and suggests what to do next", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`insights-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Review ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Review/ })).toBeVisible();

  await page.goto("/admin/insights");
  await expect(page.getByRole("heading", { name: "Store review" })).toBeVisible();
  await page.getByRole("button", { name: "Review my store" }).click();
  // A brand-new store has no sales, so the first suggestion is about getting found.
  await expect(page.getByRole("heading", { name: "1. Get your first visitors" })).toBeVisible();
  await expect(page.getByText(/has no orders in the last 30 days yet/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Email campaigns" })).toHaveAttribute("href", "/admin/campaigns");
  await shot(page, "145-store-review");

  // Asking again straight away is refused: the numbers won't have changed.
  await page.getByRole("button", { name: "Review again" }).click();
  await expect(page.getByText(/in the last 12 hours/)).toBeVisible();

  // It can run by itself every Monday.
  await page.goto("/admin/ai");
  // Its look-ups show in the activity log, under its name.
  await expect(page.getByRole("cell", { name: "Business analyst" }).first()).toBeVisible();
  await page.getByLabel("Review my store every Monday").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/admin/insights");
  await expect(page.getByText("It also runs every Monday.")).toBeVisible();
});
