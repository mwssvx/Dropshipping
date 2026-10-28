import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// The customer list shows only people who bought for delivery to one country, so a merchant can
// tag them or send them a code before a local holiday.

async function buy(browser: Browser, info: TestInfo, product: string, email: string, uk: boolean) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill(uk ? "Zoe Hart" : "Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill(uk ? "10 Downing St" : "1 Main St");
  await buyer.getByLabel("City").fill(uk ? "London" : "Austin");
  if (!uk) await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill(uk ? "SW1A 1AA" : "78701");
  if (uk) await buyer.getByLabel("Country").selectOption("GB");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: /^Thank you/ })).toBeVisible();
  await buyer.context().close();
}

test("a merchant lists the customers in one country", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Places ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Places/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  await buy(browser, info, lamp, `ada-${id}@example.com`, false);
  await buy(browser, info, lamp, `zoe-${id}@example.com`, true);

  await page.goto("/admin/customers");
  const people = page.getByRole("table").getByRole("link", { name: /Lovelace|Hart/ });
  await expect(people).toHaveCount(2);
  await page.getByLabel("Bought for delivery to").selectOption({ label: "United Kingdom (1)" });
  await expect(page).toHaveURL(/country=GB/);
  await expect(people).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Zoe Hart" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download these customers as a spreadsheet" })).toHaveAttribute("href", /country=GB/);

  // Tag everyone in the UK at once.
  await page.getByText("Tag these customers").click();
  await page.getByLabel("Tag for everyone here").fill("uk");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByText("Added “uk” to 1 customer")).toBeVisible();

  await page.getByLabel("Bought for delivery to").selectOption({ label: "Every country" });
  await expect(people).toHaveCount(2);
});
