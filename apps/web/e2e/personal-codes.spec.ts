import { expect, test } from "@playwright/test";

// Personal codes: the merchant emails one customer a one-time code from their page, and the
// customer's "Shop now" link puts it in their cart.

test("a merchant sends a customer a code, and they use it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sorry ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sorry/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const email = `pc-buyer-${id}@example.com`;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const checkout = async () => {
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).fill(email);
    await buyer.getByLabel("Full name").fill("Ada Lovelace");
    await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
  };
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await checkout();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/customers");
  await page.getByRole("link", { name: "Ada Lovelace" }).click();
  const section = page.getByRole("region", { name: "Send a code" });
  await section.getByLabel("Off").selectOption({ label: "Amount ($)" });
  await section.getByLabel("Amount", { exact: true }).fill("5.00");
  await section.getByLabel("Message (optional)").fill("Sorry your parcel took so long.");
  await section.getByRole("button", { name: "Email them a code" }).click();
  await expect(section.getByText(/^Sent FOR-[A-Z2-9]{6}\.$/)).toBeVisible();
  const code = (await section.getByText(/^Sent FOR-/).textContent())!.slice(5, -1);
  await expect(section.getByRole("list", { name: "Codes sent" })).toContainText(`${code} · $5.00 off`);
  await expect(section.getByRole("list", { name: "Codes sent" })).toContainText("Until");

  // The buyer follows the link in the email: the code is in their cart, and works with their email.
  const [store, product] = lamp.split("/products/");
  await buyer.goto(`${store}/discount/${code}?to=/products/${product}`);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByText(`Discount (${code})`)).toBeVisible();
  await checkout();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await page.reload();
  await expect(section.getByRole("list", { name: "Codes sent" })).toContainText("Used on #1002");
});
