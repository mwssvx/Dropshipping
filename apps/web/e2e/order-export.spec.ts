import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Orders as a spreadsheet: the order list downloads as a CSV, one row per item.

test("the merchant downloads their orders as a CSV", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`csv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sheets ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sheets/ })).toBeVisible();
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

  await page.goto("/admin/orders");
  await page.getByText("Download as a spreadsheet").click();
  const today = new Date().toISOString().slice(0, 10);
  const form = page.getByRole("form", { name: "Download orders" });
  await form.getByLabel("From").fill(today);
  await form.getByLabel("To").fill(today);
  const [download] = await Promise.all([page.waitForEvent("download"), form.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`-orders-${today}-${today}\\.csv$`));
  const csv = await readFile((await download.path())!, "utf8");
  const [header, row] = csv.trimEnd().split("\n");
  expect(header).toMatch(/^Order,Placed,Paid,Email,Name,/);
  expect(row).toContain(`1001,`);
  expect(row).toContain(`ada-${id}@example.com,Ada Lovelace,1 Main St`);
  expect(row).toContain("Sunset Projection Lamp");
});
