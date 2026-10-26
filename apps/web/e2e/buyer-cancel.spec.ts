import { expect, test } from "@playwright/test";

// A buyer cancels their own order before it ships: the supplier order is stopped and they're
// refunded in full. The merchant can turn it off.

test("a buyer cancels their order from its page and gets a refund", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Cancel ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Cancel/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Linen Shirt");
  await page.getByLabel("Price", { exact: true }).fill("30.00");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buy = async (email: string, name: string) => {
    const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
    await buyer.goto(store);
    await buyer.getByRole("button", { name: "Add to cart" }).click();
    await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
    await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).first().fill(email);
    await buyer.getByLabel("Full name").fill(name);
    await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
    await buyer.getByRole("button", { name: /^Pay / }).click();
    await expect(buyer.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
    return buyer;
  };

  const grace = await buy(`grace-${id}@example.com`, "Grace Hopper");
  await grace.getByText("Cancel this order").click();
  await expect(grace.getByText(/You can cancel it here until .* UTC/)).toBeVisible();
  await grace.getByLabel("Why are you cancelling? (optional)").fill("Ordered the wrong size");
  await grace.getByRole("button", { name: "Cancel order and refund me" }).click();
  await expect(grace.getByText(/^You cancelled this order on .*\. The refund is on its way to your card, and we've emailed you\.$/)).toBeVisible();
  await grace.reload();
  await expect(grace.getByText(/You cancelled this order on/)).toBeVisible();
  await expect(grace.getByText("Cancel this order")).toHaveCount(0);

  // The merchant sees it refunded.
  await page.goto("/admin/orders");
  await expect(page.getByRole("row").filter({ hasText: "#1001" })).toContainText("Refunded");

  // Turned off: the next buyer doesn't get the option.
  await page.getByText("Buyer cancellations").click();
  await page.getByLabel(/Let buyers cancel their order from its page/).uncheck();
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const ada = await buy(`ada-${id}@example.com`, "Ada Lovelace");
  await expect(ada.getByText("Cancel this order")).toHaveCount(0);
});
