import { expect, test, type Page } from "@playwright/test";

// Supplier price watch: when a supplier charges more, the merchant sees the margin drop and raises
// the price or keeps it; with automatic repricing on, the store raises it by itself.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("merchants see supplier price rises and raise or keep their prices", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pw-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/price-changes");
  await expect(page.getByText("No supplier price rises to look at.")).toBeVisible();
  const watch = page.getByRole("region", { name: "Price watch" });
  await watch.getByLabel("Raise prices automatically with my pricing rule").check();
  await watch.getByLabel("Warn me below this margin (%)").fill("95");
  await watch.getByRole("button", { name: "Save price watch" }).click();
  await expect(watch.getByRole("alert")).toContainText("Use a margin from 0% to 90%.");
  await expect(watch.getByLabel("Raise prices automatically with my pricing rule")).toBeChecked();
  await watch.getByLabel("Raise prices automatically with my pricing rule").uncheck();
  await watch.getByLabel("Warn me below this margin (%)").fill("25");
  await watch.getByRole("button", { name: "Save price watch" }).click();
  await expect(watch.getByText("Saved.")).toBeVisible();

  // The supplier now charges 90% of the price.
  const simulate = async () => {
    const button = page.getByRole("button", { name: "Simulate a supplier price rise" });
    // The test-mode panel stays open after the first use.
    if (!(await button.isVisible())) await page.getByText("Test mode: simulate a supplier price rise").click();
    await button.click();
  };
  await simulate();
  const open = page.getByRole("list", { name: "Price rises to look at" });
  await expect(open.getByRole("listitem")).toHaveCount(1);
  await expect(open.getByRole("listitem")).toContainText(/Margin \d+% → 10%, below your 25%/);
  if (info.project.name === "desktop") await expect(page.getByRole("link", { name: /^Price changes\s*1$/ })).toBeVisible();
  await shot(page, "321-price-rise");

  await open.getByRole("button", { name: /^Raise to \$/ }).click();
  await expect(page.getByText("No supplier price rises to look at.")).toBeVisible();
  const done = page.getByRole("list", { name: "Price rises dealt with" });
  await expect(done.getByRole("listitem").first()).toContainText("Price raised");

  // Another rise: kept this time.
  await simulate();
  await open.getByRole("button", { name: "Keep price" }).click();
  await expect(done.getByRole("listitem").filter({ hasText: "Price kept" })).toHaveCount(1);

  // With automatic repricing, it's raised straight away.
  await watch.getByLabel("Raise prices automatically with my pricing rule").check();
  await watch.getByRole("button", { name: "Save price watch" }).click();
  await expect(watch.getByText("Saved.")).toBeVisible();
  await simulate();
  await expect(done.getByRole("listitem").filter({ hasText: "Raised automatically" })).toHaveCount(1);
  await expect(page.getByText("No supplier price rises to look at.")).toBeVisible();
  await shot(page, "322-price-changes");
});
