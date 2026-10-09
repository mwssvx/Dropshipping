import { expect, test, type Page } from "@playwright/test";

// Own suppliers: the merchant adds a supplier they already work with, picks them for a product,
// and a paid order reaches them by email. They add tracking on a private page with no account,
// or say they can't send it, which shows up as a problem order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function setUp(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`own-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Oak ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Oak/ })).toBeVisible();
  await page.goto("/admin/products/import");
  // AliExpress links are recognised, and say what's missing until AliExpress is connected.
  await page.getByLabel("Product link").fill("https://www.aliexpress.com/item/1005001234567890.html");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText("AliExpress isn't connected yet.", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const productAdmin = page.url().split("?")[0]!;
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const supplierEmail = `orders-${id}@woodworks.example`;
  await page.goto("/admin/suppliers");
  await expect(page.getByRole("region", { name: "AliExpress" })).toContainText("Not connected");
  await expect(page.getByRole("region", { name: "CJ Dropshipping" })).toContainText("Not connected");
  await page.getByLabel("Supplier name").fill("Austin Woodworks");
  await page.getByLabel("Orders go to").fill(supplierEmail);
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Supplier added" })).toBeVisible();
  const card = page.getByRole("listitem", { name: "Austin Woodworks" });
  await expect(card).toContainText(supplierEmail);
  const portal = await card.getByRole("textbox", { name: /Tracking page link/ }).inputValue();
  expect(portal).toMatch(/\/supplier\/[0-9a-f]{64}$/);
  await shot(page, "97-own-suppliers");

  await page.goto(productAdmin);
  await page.getByLabel("Sent by").selectOption({ label: "Austin Woodworks" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Sent by")).toHaveValue(/[0-9a-f-]{36}/);
  return { product, portal, supplierEmail };
}

async function buy(page: Page, productUrl: string, email: string) {
  await page.goto(productUrl);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Check out" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or region").fill("TX");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
}

async function openOrder(page: Page) {
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).first().getAttribute("href"))!);
}

test("an order goes to the merchant's own supplier by email, and their tracking reaches the buyer", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const { product, portal, supplierEmail } = await setUp(page, id);
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const buyerEmail = `own-buyer-${id}@example.com`;
  await buy(buyer, product, buyerEmail);

  // The supplier's email has the address and the link, but not the buyer's email.
  const inbox = await page.context().newPage();
  await inbox.goto("/dev/mail");
  const po = inbox.getByRole("article").filter({ hasText: supplierEmail }).filter({ hasText: "New order PO-1001" });
  await expect(po).toBeVisible();
  await expect(po).toContainText("Ship to:");
  await expect(po).toContainText(portal);
  await expect(po).not.toContainText(buyerEmail);
  await inbox.close();

  await openOrder(page);
  await expect(page.getByText(/Sent to Austin Woodworks/)).toBeVisible();

  // The supplier needs no account.
  const supplier = await (await browser.newContext({ ...info.project.use })).newPage();
  await supplier.goto(portal);
  await expect(supplier.getByRole("heading", { name: /^Orders to send for Oak/ })).toBeVisible();
  const order = supplier.getByRole("article", { name: "Order PO-1001" });
  await expect(order).toContainText("Sunset Projection Lamp");
  await expect(order).toContainText("1 Main St");
  await shot(supplier, "98-supplier-page");
  await order.getByLabel("Carrier").fill("UPS");
  await order.getByLabel("Tracking number").fill("1Z999AA10123456784");
  await order.getByRole("button", { name: "Mark shipped" }).click();
  await expect(supplier.getByRole("status")).toContainText("Marked as shipped");
  await supplier.reload();
  await expect(supplier.getByText("Nothing to send right now.")).toBeVisible();
  await expect(supplier.getByRole("region", { name: "Sent" })).toContainText("UPS 1Z999AA10123456784");

  await page.reload();
  await expect(page.getByText(/Shipped with UPS, tracking 1Z999AA10123456784/)).toBeVisible();
  const mail = await page.context().newPage();
  await mail.goto("/dev/mail");
  await expect(mail.getByRole("article").filter({ hasText: buyerEmail }).filter({ hasText: "is on its way" })).toContainText("UPS: 1Z999AA10123456784");
  await mail.close();

  // A link that was reset stops working.
  await page.goto("/admin/suppliers");
  await page.getByRole("listitem", { name: "Austin Woodworks" }).getByRole("button", { name: "New link" }).click();
  await expect(page.getByText("New link made.")).toBeVisible();
  await supplier.goto(portal);
  await expect(supplier.getByRole("heading", { name: /^Orders to send/ })).toHaveCount(0);
});

test("a supplier who can't send it turns the order into a problem the merchant sees", async ({ page, browser }, info) => {
  const id = `${info.project.name}-no-${Date.now()}`;
  const { product, portal } = await setUp(page, id);
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buy(buyer, product, `own-buyer2-${id}@example.com`);

  const supplier = await (await browser.newContext({ ...info.project.use })).newPage();
  await supplier.goto(portal);
  const order = supplier.getByRole("article", { name: "Order PO-1001" });
  await order.getByText("Can't send this order?").click();
  await order.getByLabel("Reason").selectOption("out_of_stock");
  await order.getByLabel("Note for the store (optional)").fill("Back on the 20th");
  await order.getByRole("button", { name: "Tell the store" }).click();
  await expect(supplier.getByRole("status")).toContainText("The store has been told");

  await openOrder(page);
  await expect(page.getByRole("heading", { name: "The supplier couldn't take this order" })).toBeVisible();
  await expect(page.getByText('Austin Woodworks can\'t send it: out of stock. They said: "Back on the 20th"').first()).toBeVisible();
  // Its only order failed, so nothing is left to send and the supplier can be removed.
  await page.goto("/admin/suppliers");
  await page.getByRole("listitem", { name: "Austin Woodworks" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("listitem", { name: "Austin Woodworks" })).toHaveCount(0);
});
