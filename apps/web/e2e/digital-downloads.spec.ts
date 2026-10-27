import { expect, test } from "@playwright/test";

// Digital downloads: the merchant uploads a file to one of their own products, a buyer pays
// with nothing shipped, and downloads it from their order page.

test("a buyer pays for a file and downloads it from their order", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`dd-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Patterns ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Patterns/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Sock Knitting Pattern");
  await page.getByLabel("Price", { exact: true }).fill("6.00");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const digital = page.locator("section", { has: page.getByRole("heading", { name: "Digital download" }) });
  await digital.getByLabel("File to sell").setInputFiles({ name: "sock-pattern.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 sock pattern") });
  await digital.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Uploaded. Buyers get a download link as soon as they pay, and nothing is shipped.")).toBeVisible();
  await expect(digital.getByText("sock-pattern.pdf")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await expect(buyer.getByText("Instant download after you pay. Nothing is shipped.")).toBeVisible();
  await expect(buyer.locator("#shipping-cost")).toHaveCount(0);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
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

  const downloads = buyer.locator("#downloads");
  await expect(downloads.getByRole("heading", { name: "Your downloads" })).toBeVisible();
  await expect(downloads.getByText("5 downloads left")).toBeVisible();
  const [file] = await Promise.all([buyer.waitForEvent("download"), downloads.getByRole("link", { name: "sock-pattern.pdf" }).click()]);
  expect(file.suggestedFilename()).toBe("sock-pattern.pdf");
  await buyer.reload();
  await expect(downloads.getByText("4 downloads left")).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByText("Downloaded 1 of 5 times")).toBeVisible();
  await page.getByRole("button", { name: "Give downloads back" }).click();
  await expect(page.getByText("Done. Every link on this order works 5 times again for each one bought.")).toBeVisible();
  await expect(page.getByText("Downloaded 0 of 5 times")).toBeVisible();
});
