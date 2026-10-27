import { expect, test } from "@playwright/test";

// Tracking from a spreadsheet: the merchant downloads the orders waiting for tracking, fills in
// the carrier and tracking number, and uploads it. The order shows as shipped and the buyer gets
// the shipping email.

test("a tracking file marks orders shipped", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`tr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Packers ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Packers/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const email = `parcel-${id}@example.com`;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  const template = await (await page.request.get("/admin/orders/tracking.csv")).text();
  expect(template.split("\n")[0]).toBe("Order,Name,Country,Items,Carrier,Tracking number,Tracking link");
  expect(template).toContain("1001,Ada Lovelace,US,1 × Sunset Projection Lamp");

  await page.goto("/admin/orders");
  await page.getByText("Add tracking from a spreadsheet").click();
  const form = page.getByRole("form", { name: "Add tracking from a spreadsheet" });
  const file = "Order,Carrier,Tracking number\n#1001,USPS,9400111899223100001234\n#1002,USPS,9400111899223100005678\n";
  await form.getByLabel("Tracking file (CSV)").setInputFiles({ name: "tracking.csv", mimeType: "text/csv", buffer: Buffer.from(file) });
  await form.getByRole("button", { name: "Add tracking" }).click();
  await expect(form.getByRole("status")).toContainText("Marked 1 order shipped and emailed the buyers.");
  await expect(form.getByRole("status")).toContainText("Line 3 (#1002): There's no order with this number.");

  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByText("9400111899223100001234", { exact: true })).toBeVisible();
  await page.goto("/dev/mail");
  await expect(page.getByRole("article").filter({ hasText: email }).filter({ hasText: "on its way" }).first()).toContainText("USPS: 9400111899223100001234");
});
