import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// Customer list filters: repeat buyers, lapsed buyers, subscribers and people who never bought.

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

test("a merchant narrows the customer list to repeat buyers", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cf-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Loyal ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Loyal/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await buy(browser, info, lamp, `ada-${id}@example.com`, "Ada Lovelace");
  await buy(browser, info, lamp, `ada-${id}@example.com`, "Ada Lovelace");
  await buy(browser, info, lamp, `zoe-${id}@example.com`, "Zoe Hart");

  await page.goto("/admin/customers");
  const names = () => page.getByRole("table").getByRole("link", { name: /Lovelace|Hart/ }).allTextContents();
  await expect.poll(names).toEqual(["Zoe Hart", "Ada Lovelace"]);
  const show = page.getByRole("navigation", { name: "Show customers" });
  await show.getByRole("link", { name: "Bought more than once" }).click();
  await expect(page).toHaveURL(/filter=repeat/);
  await expect.poll(names).toEqual(["Ada Lovelace"]);
  await expect(page.getByText("1 customer", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download these customers as a spreadsheet" })).toHaveAttribute("href", /filter=repeat/);
  const csv = await (await page.request.get((await page.getByRole("link", { name: "Download these customers as a spreadsheet" }).getAttribute("href"))!)).text();
  expect(csv).toContain(`ada-${id}@example.com`);
  expect(csv).not.toContain(`zoe-${id}@example.com`);

  await show.getByRole("link", { name: "Never bought" }).click();
  await expect(page.getByText("No customers here yet.")).toBeVisible();
  await show.getByRole("link", { name: "Everyone" }).click();
  await expect.poll(names).toEqual(["Zoe Hart", "Ada Lovelace"]);
});
