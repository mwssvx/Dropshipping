import { expect, test } from "@playwright/test";

// Store policies: the merchant reads the drafted returns, shipping and privacy pages, adds them, and
// buyers can read them on the store.

test("a merchant adds policy pages written from their settings", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pol-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Policied ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Policied/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Clay Mug");
  await page.getByLabel("Price", { exact: true }).fill("14.00");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");

  await page.goto("/admin/pages");
  const policies = page.getByRole("region", { name: "Store policies" });
  await policies.getByText("Read it first").first().click();
  await expect(policies.getByText(/You can ask for a return within 30 days of delivery/)).toBeVisible();
  await policies.getByRole("checkbox", { name: /Terms of service/ }).uncheck();
  await policies.getByRole("button", { name: "Add policy pages" }).click();
  await expect(page.getByText("Added Returns and refunds, Shipping, Privacy policy, Accessibility statement.")).toBeVisible();
  await expect(page.getByRole("table").getByRole("link", { name: "Shipping", exact: true })).toBeVisible();
  await expect(policies.getByRole("checkbox", { name: /Terms of service/ })).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${store}/pages/returns`);
  await expect(buyer.getByRole("heading", { name: "Returns and refunds" })).toBeVisible();
  await expect(buyer.getByText(/You can ask for a return within 30 days of delivery/)).toBeVisible();
  await buyer.goto(`${store}/pages/accessibility`);
  await expect(buyer.getByRole("heading", { name: "Accessibility statement" })).toBeVisible();
  await expect(buyer.getByText(/WCAG\) 2\.1 at level AA/)).toBeVisible();
  await buyer.goto(`${store}/pages/terms`);
  await expect(buyer.getByRole("heading", { name: "Terms of service" })).toHaveCount(0);
});
