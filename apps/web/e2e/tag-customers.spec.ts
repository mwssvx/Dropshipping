import { expect, test, type Browser, type TestInfo } from "@playwright/test";

// Tag everyone in the customer list: repeat buyers get "loyal", ready for a code or campaign.

async function buy(browser: Browser, info: TestInfo, product: string, email: string, name: string) {
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).fill(email);
  await buyer.getByLabel("Full name").fill(name);
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
  await buyer.context().close();
}

test("a merchant tags every repeat buyer at once", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`tc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Regulars ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Regulars/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await buy(browser, info, lamp, `ada-${id}@example.com`, "Ada Lovelace");
  await buy(browser, info, lamp, `ada-${id}@example.com`, "Ada Lovelace");
  await buy(browser, info, lamp, `zoe-${id}@example.com`, "Zoe Hart");

  await page.goto("/admin/customers?filter=repeat");
  await page.getByText("Tag these customers").click();
  await expect(page.getByText("Changes all 1 customer in this list")).toBeVisible();
  await page.getByLabel("Tag for everyone here").fill("Loyal");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added “loyal” to 1 customer." })).toBeVisible();

  // The new tag filters the whole list down to Ada.
  await page.goto("/admin/customers");
  await page.getByRole("navigation", { name: "Filter by tag" }).getByRole("link", { name: /loyal/ }).click();
  await expect(page.getByRole("table").getByRole("link", { name: /Lovelace|Hart/ })).toHaveText(["Ada Lovelace"]);

  await page.getByText("Tag these customers").click();
  await page.getByLabel("Tag for everyone here").fill("loyal");
  await page.getByRole("button", { name: "Remove tag" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Removed “loyal” from 1 customer." })).toBeVisible();
});
