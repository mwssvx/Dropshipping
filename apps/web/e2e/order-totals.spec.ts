import { expect, test } from "@playwright/test";

// The order list filters by order total, so a merchant can find the big orders worth a thank-you
// note or a closer look.

test("a merchant lists orders by total", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ot-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Totals ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Totals/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(lamp.replace(/\/products\/.*$/, "/cart"));
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
  await buyer.context().close();

  await page.goto("/admin/orders");
  const row = page.getByRole("row", { name: /Ada Lovelace/ });
  const total = Number((await row.getByRole("cell", { name: /^\$/ }).last().innerText()).replace(/[^\d.]/g, ""));
  const fits = total < 25 ? "Under $25.00" : total < 100 ? "$25.00 to $100.00" : total < 250 ? "$100.00 to $250.00" : "$250.00 or more";
  const other = fits === "$250.00 or more" ? "Under $25.00" : "$250.00 or more";

  await page.getByLabel("Order total").selectOption({ label: fits });
  await expect(page).toHaveURL(/total=[a-z\d]/);
  await expect(page.getByRole("checkbox", { name: /^Pick order #/ })).toHaveCount(1);
  // Wait for the list to reload with the other range before counting again.
  const fitsUrl = page.url();
  await page.getByLabel("Order total").selectOption({ label: other });
  await expect(page).not.toHaveURL(fitsUrl);
  await expect(page.getByRole("checkbox", { name: /^Pick order #/ })).toHaveCount(0);
  await page.getByLabel("Order total").selectOption({ label: "Any total" });
  await expect(page).not.toHaveURL(/total=[a-z\d]/);
  await expect(page.getByRole("checkbox", { name: /^Pick order #/ })).toHaveCount(1);

  // A choice made before the page's scripts have loaded still counts once they do.
  let release!: () => void;
  const ready = new Promise<void>((r) => (release = r));
  await page.route("**/_next/static/chunks/**", async (r) => { await ready; await r.continue(); });
  await page.reload({ waitUntil: "commit" });
  await page.getByLabel("Order total").selectOption({ label: other });
  release();
  await expect(page).toHaveURL(/total=[a-z\d]/);
  await expect(page.getByRole("checkbox", { name: /^Pick order #/ })).toHaveCount(0);
  await page.unroute("**/_next/static/chunks/**");
});
