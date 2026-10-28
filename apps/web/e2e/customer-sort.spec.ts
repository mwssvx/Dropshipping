import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// Sorting the customer list: last order by default, or by name, money spent and more.

async function buy(browser: Browser, info: TestInfo, product: string, email: string, name: string) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill(name);
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
  await buyer.context().close();
}

test("a merchant sorts customers by name and keeps the sort while filtering", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Ranked ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Ranked/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await buy(browser, info, lamp, `ada-${id}@example.com`, "Ada Lovelace");
  await buy(browser, info, lamp, `zoe-${id}@example.com`, "Zoe Hart");

  await page.goto("/admin/customers");
  const names = () => page.getByRole("table").getByRole("link", { name: /Lovelace|Hart/ }).allTextContents();
  // The latest buyer first.
  await expect.poll(names).toEqual(["Zoe Hart", "Ada Lovelace"]);
  await expect(page.getByLabel("Sort customers").getByRole("option", { name: "Most spent" })).toHaveCount(1);
  await page.getByLabel("Sort customers").selectOption({ label: "Name A to Z" });
  await expect(page).toHaveURL(/sort=name/);
  await expect.poll(names).toEqual(["Ada Lovelace", "Zoe Hart"]);
  await page.getByLabel("Search customers").fill("example.com");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=example.com/);
  await expect(page).toHaveURL(/sort=name/);
  await expect.poll(names).toEqual(["Ada Lovelace", "Zoe Hart"]);
});
