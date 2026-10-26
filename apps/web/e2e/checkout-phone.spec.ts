import { expect, test } from "@playwright/test";

// Phone number at checkout: the merchant picks whether checkout asks for one on the Shipping
// page, the buyer's number is checked, and it shows on the order for the merchant.

test("checkout asks for a phone number for the courier, and the order shows it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ph-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Courier ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Courier/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  const phone = page.getByRole("region", { name: "Phone number at checkout" });
  await expect(phone.getByLabel("Ask for it, but buyers can leave it empty")).toBeChecked();
  await phone.getByLabel("Buyers must enter one").check();
  await phone.getByRole("button", { name: "Save" }).click();
  await page.reload();
  await expect(phone.getByLabel("Buyers must enter one")).toBeChecked();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(`ph-buyer-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await expect(buyer.getByLabel("Phone for the courier")).toHaveAttribute("required", "");
  await buyer.getByLabel("Phone for the courier").fill("call me");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await expect(buyer.getByText("Check the phone number. Include the area code, like +1 512 555 0100.")).toBeVisible();
  await buyer.getByLabel("Phone for the courier").fill("+1 512 555 0100");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("link", { name: "+1 512 555 0100" })).toHaveAttribute("href", "tel:+15125550100");
});
