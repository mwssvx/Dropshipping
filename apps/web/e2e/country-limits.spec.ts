import { expect, test } from "@playwright/test";

// Countries a product can't go to: buyers there are told on the product page, and checkout stops before payment.

test("a product that can't ship to a country says so and stops checkout", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cl-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Blades ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Blades/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Chef's Knife");
  await page.getByLabel("Price", { exact: true }).fill("45.00");
  await page.getByLabel("Stock", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const section = page.getByRole("region", { name: "Countries it can't go to" });
  await section.getByRole("checkbox", { name: "United Kingdom" }).check();
  await section.getByRole("button", { name: "Save countries" }).click();
  await expect(section.getByText("Doesn't ship to United Kingdom.")).toBeVisible();

  const us = await (await browser.newContext({ ...info.project.use, extraHTTPHeaders: { "x-vercel-ip-country": "US" } })).newPage();
  await us.goto(store);
  await expect(us.getByRole("heading", { name: "Chef's Knife" })).toBeVisible();
  await expect(us.getByText(/can't be shipped to/)).toHaveCount(0);

  const uk = await (await browser.newContext({ ...info.project.use, extraHTTPHeaders: { "x-vercel-ip-country": "GB" } })).newPage();
  await uk.goto(store);
  await expect(uk.getByText("This item can't be shipped to United Kingdom.")).toBeVisible();
  await uk.getByRole("button", { name: "Add to cart" }).click();
  await expect(uk.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await uk.goto(store.replace(/\/products\/.*$/, "/cart"));
  await uk.getByRole("link", { name: "Check out" }).click();
  await uk.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await uk.getByLabel("Full name").fill("Ada Lovelace");
  await uk.getByLabel("Address", { exact: true }).fill("10 Downing St");
  await uk.getByLabel("City").fill("London");
  await uk.getByLabel("Postal code").fill("SW1A 1AA");
  await uk.getByLabel("Country").selectOption("GB");
  await uk.getByRole("button", { name: "Continue to payment" }).click();
  await expect(uk.getByRole("main").getByText("Chef's Knife can't be shipped to United Kingdom. Remove it from your cart to check out.")).toBeVisible();
});
