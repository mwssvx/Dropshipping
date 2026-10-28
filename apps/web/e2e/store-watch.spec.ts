import { expect, test, type Page } from "@playwright/test";

// The daily store watch: on by default, shown on Insights, and the owner can turn it off.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test("the store watch shows on Insights and can be turned off", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`watch-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Watch ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Watch/ })).toBeVisible();

  await page.goto("/admin/insights");
  const watch = page.getByRole("region", { name: "Store watch" });
  await expect(watch).toContainText("Each morning, yesterday is compared with your last four weeks.");
  await expect(watch).toContainText("Nothing out of line so far.");
  await shot(page, "149-store-watch");

  await page.goto("/admin/ai");
  const box = page.getByLabel(/Watch my store every day/);
  await expect(box).toBeChecked();
  await box.uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Watch my store every day/)).not.toBeChecked();
  await page.goto("/admin/insights");
  await expect(page.getByRole("region", { name: "Store watch" })).toContainText("The daily store watch is off.");
});
