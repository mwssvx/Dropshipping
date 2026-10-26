import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Customers as a spreadsheet: the customer list downloads as a CSV, with the list's tag.

test("the merchant downloads their customers as a CSV", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ccsv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`People ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to People/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
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

  await page.goto("/admin/customers");
  const today = new Date().toISOString().slice(0, 10);
  let [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download all customers as a spreadsheet" }).click()]);
  expect(download.suggestedFilename()).toMatch(/-customers\.csv$/);
  let csv = await readFile((await download.path())!, "utf8");
  const lines = csv.trimEnd().split("\n");
  expect(lines[0]).toBe("Email,Name,City,Country,Orders,Spent,First order,Last order,Email marketing,Account,Tags,Customer since");
  expect(lines[1]).toMatch(new RegExp(`^ada-${id}@example.com,Ada Lovelace,Austin,US,1,\\d+\\.\\d{2},${today},${today},not subscribed,no,,${today}$`));

  // Tag them, then download just that tag.
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  await page.getByLabel("Tags", { exact: true }).fill("vip");
  await page.getByRole("button", { name: "Save note and tags" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/admin/customers");
  await page.getByRole("navigation", { name: "Filter by tag" }).getByRole("link", { name: /vip/ }).click();
  [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download these customers as a spreadsheet" }).click()]);
  expect(download.suggestedFilename()).toMatch(/-customers-vip\.csv$/);
  csv = await readFile((await download.path())!, "utf8");
  expect(csv.trimEnd().split("\n")).toHaveLength(2);
  expect(csv).toContain(",vip,");
});
