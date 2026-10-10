import { expect, test, type Page } from "@playwright/test";

// Profit report: profit per product after supplier costs, fees and the ad spend the merchant enters.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant enters ad spend and sees each product's profit after ads", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Margins ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Margins/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/money");
  await page.getByRole("link", { name: "Profit report" }).click();
  await expect(page.getByRole("heading", { name: "Profit", level: 1 })).toBeVisible();
  await expect(page.getByText("No paid orders in this period yet.")).toBeVisible();

  await page.getByLabel(/Amount spent/).fill("abc");
  await page.getByRole("button", { name: "Add ad spend" }).click();
  await expect(page.getByText("Enter how much you spent, like 25.00.")).toBeVisible();
  await page.getByLabel("Where").selectOption({ label: "Facebook and Instagram" });
  await page.getByLabel(/Amount spent/).fill("40.00");
  await page.getByLabel("For product").selectOption({ label: "Sunset Projection Lamp" });
  await page.getByLabel("Note (optional)").fill("Launch week");
  await page.getByRole("button", { name: "Add ad spend" }).click();
  await expect(page.getByText("Ad spend added.")).toBeVisible();
  await page.getByLabel(/Amount spent/).fill("10");
  await page.getByLabel("Where").selectOption({ label: "TikTok" });
  // The form keeps the last day, channel and product for the next entry.
  await expect(page.getByLabel("For product")).toHaveValue(/.+/);
  await page.getByLabel("For product").selectOption({ label: "Whole store" });
  await page.getByRole("button", { name: "Add ad spend" }).click();

  const byProduct = page.getByRole("region", { name: "By product" });
  const lamp = byProduct.getByRole("row", { name: /Sunset Projection Lamp/ });
  await expect(lamp).toContainText("−$40.00");
  await expect(lamp).toContainText("-$40.00");
  await expect(byProduct.getByRole("row", { name: /Ads for the whole store/ })).toContainText("−$10.00");
  await expect(page.getByRole("region", { name: "Totals" })).toContainText("-$50.00");
  await expect(page.getByText("Facebook and Instagram $40.00 · TikTok $10.00")).toBeVisible();
  await shot(page, "191-profit-report");

  await page.getByRole("link", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(/days=7/);
  await page.getByRole("button", { name: "Remove $10.00" }).click();
  await expect(byProduct.getByRole("row", { name: /Ads for the whole store/ })).toHaveCount(0);

  await page.goto("/admin/money");
  await expect(page.getByText("Profit after ads")).toBeVisible();
});
