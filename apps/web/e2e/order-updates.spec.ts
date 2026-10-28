import { expect, test } from "@playwright/test";

// Emailing the buyers: tick orders on the list, write one update in your own words, and each
// buyer gets it by name with their order link; it shows on the order's timeline.

test("email an update to the buyers of picked orders", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`news-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`News ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to News/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  for (const name of ["Ada Lovelace", "Grace Hopper"]) {
    await buyer.goto(lamp);
    await buyer.getByRole("button", { name: "Add to cart" }).click();
    await buyer.getByRole("link", { name: "Check out" }).click();
    await buyer.getByRole("textbox", { name: "Email" }).fill(`b-${name.split(" ")[0]}-${id}@example.com`);
    await buyer.getByLabel("Full name").fill(name);
    await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
    await buyer.getByLabel("City").fill("Austin");
    await buyer.getByLabel("State or region").fill("TX");
    await buyer.getByLabel("Postal code").fill("78701");
    await buyer.getByRole("button", { name: "Continue to payment" }).click();
    await buyer.getByRole("button", { name: /^Pay/ }).click();
    await expect(buyer.getByRole("heading", { name: `Thank you, ${name.split(" ")[0]}!` })).toBeVisible();
  }

  await page.goto("/admin/orders");
  await page.waitForLoadState("load");
  await page.getByRole("button", { name: "Email the buyers" }).click();
  await expect(page.getByRole("status")).toContainText("Pick at least one order");

  await page.getByRole("checkbox", { name: "Pick all orders shown" }).check();
  await page.getByRole("button", { name: "Email the buyers" }).click();
  await expect(page.getByRole("heading", { name: "Email the buyers" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2 buyers get it" })).toBeVisible();
  await expect(page.getByText("#1001 Ada Lovelace, #1002 Grace Hopper")).toBeVisible();
  await page.getByLabel("Your update").fill("Our supplier is a few days behind, so your order ships by Friday. Thanks for waiting!");
  await page.getByRole("button", { name: "Email 2 buyers" }).click();
  await expect(page.getByRole("status")).toContainText("Emailed the buyers of 2 orders.");

  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByText(`Update from you email sent to b-Ada-${id}@example.com`)).toBeVisible();
});
