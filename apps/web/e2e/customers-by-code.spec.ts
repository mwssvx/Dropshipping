import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// "See customers" on a discount code lists the people who paid with it, so a merchant can tag the
// buyers a creator brought in.

async function buy(browser: Browser, info: TestInfo, product: string, name: string, code?: string) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(product.replace(/\/products\/.*$/, "/cart"));
  if (code) {
    await buyer.getByLabel("Discount or gift card code").fill(code);
    await buyer.getByRole("button", { name: "Apply" }).click();
    await expect(buyer.getByText(`Discount (${code.toUpperCase()})`)).toBeVisible();
  }
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`${name.toLowerCase()}-${Date.now()}@example.com`);
  await buyer.getByLabel("Full name").fill(`${name} Lovelace`);
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: `Thank you, ${name}!` })).toBeVisible();
  await buyer.context().close();
}

test("a merchant sees the customers who used a code", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cbc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Fans ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Fans/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/marketing");
  await page.getByLabel("Code", { exact: true }).fill("ada10");
  await page.getByLabel("Percent").fill("10");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Code created. Buyers can use it now.")).toBeVisible();

  await buy(browser, info, lamp, "Ada", "ada10");
  await buy(browser, info, lamp, "Bob");

  await page.goto("/admin/marketing");
  await page.getByRole("link", { name: "See customers who used ADA10" }).click();
  await expect(page).toHaveURL(/\/admin\/customers\?code=/);
  await expect(page.getByText("Customers who used ADA10")).toBeVisible();
  const people = page.getByRole("table").getByRole("link", { name: /Lovelace/ });
  await expect(people).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Ada Lovelace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download these customers as a spreadsheet" })).toHaveAttribute("href", /code=/);

  await page.getByText("Tag these customers").click();
  await page.getByLabel("Tag for everyone here").fill("ada-fan");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByText("Added “ada-fan” to 1 customer")).toBeVisible();

  await page.getByRole("link", { name: "Show all customers" }).click();
  await expect(people).toHaveCount(2);
});
