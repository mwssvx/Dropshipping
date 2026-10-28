import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// The order list shows only first orders from new buyers, or only orders from buyers who came
// back, so a merchant can see whether ads bring new people or the same ones.

async function buy(browser: Browser, info: TestInfo, product: string, email: string) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(product.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await buyer.context().close();
}

test("a merchant tells first orders from returning buyers", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ob-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Again ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Again/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  await buy(browser, info, lamp, `ada-${id}@example.com`);
  await buy(browser, info, lamp, `ada-${id}@example.com`);

  await page.goto("/admin/orders");
  const picks = page.getByRole("checkbox", { name: /^Pick order #/ });
  await expect(picks).toHaveCount(2);
  await page.getByLabel("New or returning buyers").selectOption({ label: "First orders" });
  await expect(page).toHaveURL(/buyer=new/);
  await expect(picks).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: "Pick order #1001" })).toBeVisible();
  await page.getByLabel("New or returning buyers").selectOption({ label: "Returning buyers" });
  await expect(page).toHaveURL(/buyer=returning/);
  await expect(picks).toHaveCount(1);
  await expect(page.getByRole("checkbox", { name: "Pick order #1002" })).toBeVisible();
});
