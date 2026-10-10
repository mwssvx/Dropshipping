import { expect, test } from "@playwright/test";

// Order risk check: a risky order waits for the merchant before it goes to the supplier.

test("a risky order is held until the merchant sends it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`risk-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Careful ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Careful/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // Stricter than the default, so one throwaway email is enough to hold it.
  await page.goto("/admin/orders?show=held");
  await expect(page.getByText("No orders on hold.")).toBeVisible();
  await page.getByLabel("Risky orders").selectOption({ label: "Hold medium- and high-risk orders" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`who-${id}@mailinator.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();

  // The check runs just after payment.
  await expect(async () => {
    await page.goto("/admin/orders?show=held");
    await expect(page.getByRole("link", { name: "#1001" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(page.getByRole("row", { name: /#1001/ }).getByText("On hold")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /looked risky and waits for you/ })).toBeVisible();

  await page.goto("/admin/orders?show=held");
  await page.getByRole("link", { name: "#1001" }).click();
  const held = page.getByRole("region", { name: "On hold: medium risk" });
  await expect(held).toContainText("The email is from a throwaway inbox service (mailinator.com).");
  await held.getByRole("button", { name: "It's fine, send it" }).click();
  await expect(page.getByRole("region", { name: "On hold: medium risk" })).toHaveCount(0);
  await expect(page.getByText("Sent to supplier").first()).toBeVisible();
  await expect(page.getByText("Checked and sent on to the supplier")).toBeVisible();
  await expect(page.getByRole("region", { name: /Risk check/ })).toContainText("Medium risk");
});
