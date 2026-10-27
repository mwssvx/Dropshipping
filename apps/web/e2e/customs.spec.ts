import { expect, test } from "@playwright/test";

// Customs forms: the merchant adds an HS code and the country a product was made in, and an
// order shipping to another country gets a printable customs declaration with both.

test("a customs form for an order going abroad", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cu-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Customs ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Customs/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const product = page.url();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`cu-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Country").selectOption("GB");
  await buyer.getByLabel("Address", { exact: true }).fill("10 Downing St");
  await buyer.getByLabel("City").fill("London");
  await buyer.getByLabel("Postal code").fill("SW1A 2AA");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await page.getByRole("link", { name: "Customs form" }).click();
  const form = page.getByRole("article", { name: "Customs declaration for order #1001" });
  await expect(form.getByRole("region", { name: "To" })).toContainText("United Kingdom");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Add the HS code and the country it was made in for Sunset Projection Lamp");
  await expect(page.getByRole("button", { name: "Print customs form" })).toBeVisible();

  await page.goto(product);
  const customs = page.getByRole("region", { name: "Customs" });
  await customs.getByLabel("HS code").fill("94-05");
  await customs.getByRole("button", { name: "Save customs info" }).click();
  await expect(customs.getByRole("alert")).toContainText("6 to 10 digits");
  await customs.getByLabel("HS code").fill("9405.40");
  await customs.getByLabel("Made in (country code)").fill("cn");
  await customs.getByRole("button", { name: "Save customs info" }).click();
  await expect(customs.getByRole("status")).toHaveText("Saved. Customs forms for this product now use it.");
  await expect(customs.getByRole("note")).toHaveText("HS code 940540, made in China.");

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await page.getByRole("link", { name: "Customs form" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(form.getByRole("row", { name: /Sunset Projection Lamp/ })).toContainText("940540");
  await expect(form.getByRole("row", { name: /Sunset Projection Lamp/ })).toContainText("China");
});
