import { expect, test } from "@playwright/test";

// Milestone 1 "done when": a test-card purchase creates an order visible in admin.
test("merchant opens a store, a buyer pays, the order shows up as paid", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const email = `owner-${id}@example.com`;
  const storeName = `Glow Lamps ${id}`;

  // Merchant signs up and creates a store.
  await page.goto("/");
  await page.getByRole("link", { name: "Start free" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(storeName);
  await page.getByLabel("Where your business is based").selectOption("US");
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: `Welcome to ${storeName}` })).toBeVisible();

  // Adds an active product, and sees the margin while typing.
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Sunset Lamp");
  await page.getByLabel("Description").fill("Turns any room golden.");
  await page.getByLabel("Price", { exact: true }).fill("24.99");
  await page.getByLabel("Your cost").fill("8.00");
  await expect(page.getByText("68% margin")).toBeVisible();
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  const storeUrl = await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href");
  expect(storeUrl).toMatch(/^\/s\/glow-lamps-/);
  const handle = storeUrl!.split("/")[2]!;

  // A buyer, in a separate browser session, buys it.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`/s/${handle}`);
  await buyer.getByRole("link", { name: /Sunset Lamp/ }).click();
  await expect(buyer.getByRole("heading", { name: "Sunset Lamp" })).toBeVisible();
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(buyer.getByText("$29.98")).toBeVisible(); // 24.99 + 4.99 shipping
  await buyer.getByRole("link", { name: "Check out" }).click();

  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Test mode")).toBeVisible();
  await buyer.getByRole("button", { name: "Pay $29.98" }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByText("Order #1001")).toBeVisible();

  // Merchant sees it as paid, with profit.
  await page.goto("/admin/orders");
  const row = page.getByRole("row", { name: /#1001/ });
  await expect(row.getByText("Paid")).toBeVisible();
  await expect(row.getByText("To send")).toBeVisible();
  await row.getByRole("link", { name: "#1001" }).click();
  await expect(page.getByText("Profit after supplier cost")).toBeVisible();
  // $29.98 paid, minus our 2% ($0.60), card fee ($1.17), the shipping charge ($4.99) and cost ($8.00).
  await expect(page.getByText("$15.22")).toBeVisible();
});

test("signed-out visitors are sent to sign in, and forged webhooks are refused", async ({ page, request }) => {
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/login$/);
  const res = await request.post("/api/webhooks/payments", {
    data: { id: "evt_x", type: "payment.succeeded", paymentIntentId: "fake_pi_x", amountMinor: 1 },
    headers: { "x-fake-signature": "forged" },
  });
  expect(res.status()).toBe(400);
});
