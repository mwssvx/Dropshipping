import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// "See buyers" on a product lists the people who paid for it, so a merchant can tag them or send
// them a code for a matching product.

async function buy(browser: Browser, info: TestInfo, product: string, name: string) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`${name.toLowerCase()}-${Date.now()}@example.com`);
  await buyer.getByLabel("Full name").fill(`${name} Lovelace`);
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: `Thank you, ${name}!` })).toBeVisible();
  await buyer.context().close();
}

async function importProduct(page: import("@playwright/test").Page, name: RegExp) {
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return { admin: page.url(), store: (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))! };
}

test("a merchant sees who bought a product", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cbp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Owners ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Owners/ })).toBeVisible();
  const lamp = await importProduct(page, /sunset projection lamp/i);
  const other = await importProduct(page, /magnetic phone stand/i);
  await buy(browser, info, lamp.store, "Ada");
  await buy(browser, info, other.store, "Bob");

  await page.goto(lamp.admin);
  await page.getByRole("link", { name: "See buyers" }).click();
  await expect(page).toHaveURL(/\/admin\/customers\?product=/);
  await expect(page.getByText("Customers who bought Sunset Projection Lamp")).toBeVisible();
  const people = page.getByRole("table").getByRole("link", { name: /Lovelace/ });
  await expect(people).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Ada Lovelace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download these customers as a spreadsheet" })).toHaveAttribute("href", /product=/);

  await page.getByText("Tag these customers").click();
  await page.getByLabel("Tag for everyone here").fill("lamp-owner");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByText("Added “lamp-owner” to 1 customer")).toBeVisible();

  await page.getByRole("link", { name: "Show everyone" }).click();
  await expect(people).toHaveCount(2);
});
