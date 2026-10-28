import { expect, test } from "@playwright/test";

// "Spent at least" narrows the customer list to the people who spent that much, after refunds, so a
// merchant can tag their best buyers as VIPs.

test("a merchant lists the customers who spent at least an amount", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Spenders ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Spenders/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

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
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await buyer.context().close();

  await page.goto("/admin/orders");
  const total = Number((await page.getByRole("row", { name: /Ada Lovelace/ }).getByRole("cell", { name: /^\$/ }).last().innerText()).replace(/[^\d.]/g, ""));
  const steps = [50, 100, 250, 500, 1000];
  const reached = steps.filter((n) => n <= total).pop();
  const above = steps.find((n) => n > total)!;
  const label = (n: number) => `$${n.toLocaleString("en-US")}.00 or more`;

  await page.goto("/admin/customers");
  const people = page.getByRole("table").getByRole("link", { name: /Lovelace/ });
  await expect(people).toHaveCount(1);
  await page.getByLabel("Spent at least").selectOption({ label: label(above) });
  await expect(page).toHaveURL(/spent=\d/);
  await expect(people).toHaveCount(0);
  if (reached) {
    await page.getByLabel("Spent at least").selectOption({ label: label(reached) });
    await expect(people).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Download these customers as a spreadsheet" })).toHaveAttribute("href", /spent=\d/);
  }
  await page.getByLabel("Spent at least").selectOption({ label: "Any amount" });
  await expect(page).not.toHaveURL(/spent=\d/);
  await expect(people).toHaveCount(1);
});
