import { expect, test } from "@playwright/test";

// Spend more, save more: money off orders over an amount applies without a code, and the cart says
// how much more to spend for the next step.

test("steps of money off by order size, with a nudge to the next one", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`st-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Steps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Steps/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/marketing");
  const step = async (code: string, percent: string, over: string) => {
    await page.getByLabel("Code", { exact: true }).fill(code);
    await page.getByLabel("Percent").fill(percent);
    await page.getByLabel("Minimum order ($)").fill(over);
    await page.getByLabel(/Apply it automatically to orders over the minimum/).check();
    await page.getByRole("button", { name: "Create code" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: code })).toContainText("automatic, no code needed");
  };
  // Without a minimum it's refused: money off everything is a sale.
  await page.getByLabel("Code", { exact: true }).fill("ALLOFF");
  await page.getByLabel("Percent").fill("10");
  await page.getByLabel(/Apply it automatically to orders over the minimum/).check();
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Set a minimum order for money off without a code.", { exact: false })).toBeVisible();
  await page.reload();
  await step("SPEND1", "10", "1.00");
  await step("SPEND999", "20", "999.00");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByRole("list", { name: "Offers" })).toContainText("10% off orders over $1.00");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await expect(buyer.getByText("Discount (10% off orders over $1.00)")).toBeVisible();
  await expect(buyer.getByText(/^Spend \$[\d,.]+ more to get 20% off your order\.$/)).toBeVisible();

  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByText("Discount (SPEND1)")).toBeVisible();
});
