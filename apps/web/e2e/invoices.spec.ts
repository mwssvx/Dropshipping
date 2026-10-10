import { expect, test, type Page } from "@playwright/test";

// Invoices: the merchant adds their business details, a buyer pays and opens a numbered invoice
// from their order page, and a refund gets a credit note in the same series.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a paid order gets an invoice, and a refund a credit note", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`inv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Night Light ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Night Light/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // Registered for Texas sales tax, with a permit number.
  await page.goto("/admin/taxes");
  await page.getByLabel("Where you're registered").selectOption("US-TX");
  await page.getByLabel("Registration number").fill("32012345678");
  await page.getByRole("button", { name: "Add registration" }).click();
  await expect(page.getByText("32012345678")).toBeVisible();

  // The business details printed on every invoice.
  await page.goto("/admin/invoices");
  await expect(page.getByText(/Most tax offices need your registered business name/)).toBeVisible();
  await page.getByLabel("Registered business name").fill("Night Light Co LLC");
  await page.getByLabel("Business address").fill("500 Congress Ave\nAustin, TX 78701");
  await page.getByLabel("Number prefix").fill("NL-");
  await page.getByLabel("Footer").fill("Thank you for your order!");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Invoice settings saved. New invoices use them.")).toBeVisible();
  await expect(page.getByText(/The next one will be NL-0001/)).toBeVisible();
  await expect(page.getByText(/Most tax offices need/)).toHaveCount(0);

  // A buyer in Texas pays and opens the invoice from their order page.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  const orderPage = buyer.url();
  await buyer.getByRole("link", { name: "Invoice", exact: true }).click();
  const invoice = buyer.getByRole("article", { name: "Invoice NL-0001" });
  await expect(invoice).toBeVisible();
  await expect(invoice).toContainText("Night Light Co LLC");
  await expect(invoice).toContainText("Sales tax permit (TX): 32012345678");
  await expect(invoice).toContainText("Sales tax (TX) 6.25%");
  await expect(invoice).toContainText("Ada Lovelace");
  await expect(invoice).toContainText("Paid in full. Thank you.");
  await expect(invoice).toContainText("Thank you for your order!");
  await expect(buyer.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
  await shot(buyer, "135-invoice");

  // The merchant refunds $10.00, which gets the next number as a credit note.
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).click();
  const invoices = page.getByRole("region", { name: "Invoices" });
  await expect(invoices.getByRole("link", { name: "Invoice NL-0001" })).toBeVisible();
  await page.getByRole("button", { name: "Refund" }).click();
  await page.getByLabel("Amount").fill("10.00");
  await page.getByLabel("Reason").fill("Arrived scratched");
  await page.getByRole("button", { name: "Refund" }).last().click();
  await expect(page.getByText("Refunded $10.00: Arrived scratched")).toBeVisible();
  await invoices.getByRole("link", { name: "Credit note NL-0002" }).click();
  const note = page.getByRole("article", { name: "Credit note NL-0002" });
  await expect(note).toContainText("For invoice");
  await expect(note).toContainText("Refund on order #1001: Arrived scratched");
  await expect(note).toContainText("Total credited");
  await expect(note).toContainText("−$10.00");
  await shot(page, "136-credit-note");

  // Both are on the Invoices page, and in the CSV for the accountant.
  await page.goto("/admin/invoices");
  await expect(page.getByRole("link", { name: "NL-0002" })).toBeVisible();
  await expect(page.getByRole("link", { name: "NL-0001" })).toBeVisible();
  await shot(page, "137-invoices-admin");
  const csv = await (await page.request.get("/admin/invoices/register.csv")).text();
  expect(csv).toMatch(/^number,type,date,order,buyer,email,country,total \(USD\),of which tax\n/);
  expect(csv).toContain("NL-0001,invoice,");
  expect(csv).toContain("NL-0002,credit note,");

  // The buyer sees the credit note next to the invoice.
  await buyer.goto(orderPage);
  await buyer.getByRole("link", { name: "Invoice and credit notes" }).click();
  await buyer.getByRole("navigation", { name: "Documents" }).getByRole("link", { name: "Credit note NL-0002" }).click();
  await expect(buyer.getByRole("article", { name: "Credit note NL-0002" })).toContainText("−$10.00");
});
