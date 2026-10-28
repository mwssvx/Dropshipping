import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// A code for first orders only: a new buyer gets it, and someone who already ordered is told
// it's for a first order when they check out.

async function checkout(browser: Browser, info: TestInfo, product: string, email: string, code: string) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(product.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByLabel("Discount or gift card code").fill(code);
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer.getByText(`Discount (${code})`)).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  return buyer;
}

test("a code for first orders works once per new buyer", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`foc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Firsts ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Firsts/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/marketing");
  await page.getByLabel("Code", { exact: true }).fill("hello15");
  await page.getByLabel("Percent").fill("15");
  await page.getByLabel("First order only").check();
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Code created. Buyers can use it now.")).toBeVisible();
  await expect(page.getByText("· first orders only")).toBeVisible();

  const email = `foc-buyer-${id}@example.com`;
  const first = await checkout(browser, info, lamp, email, "HELLO15");
  await first.getByRole("button", { name: /^Pay / }).click();
  await expect(first.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await first.context().close();

  const again = await checkout(browser, info, lamp, email, "HELLO15");
  await expect(again.getByText("HELLO15 is for a first order only.")).toBeVisible();
  await again.context().close();
});
