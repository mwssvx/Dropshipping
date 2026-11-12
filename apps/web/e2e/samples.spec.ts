import { expect, test } from "@playwright/test";

// Samples: before selling a supplier product, the merchant orders one to their own door. It goes to
// the supplier like an order but isn't a sale.

test("a merchant orders a sample of an imported product", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sample-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();

  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const panel = page.getByRole("region", { name: "Order a sample" });
  await expect(panel).toContainText("It isn't a sale");
  await panel.getByLabel("Send to").fill("Ada Owner");
  await panel.getByLabel("Street").fill("1 Main St");
  await panel.getByLabel("Town or city").fill("Austin");
  await panel.getByLabel("State or county (optional)").fill("TX");
  await panel.getByLabel("Postcode or ZIP").fill("78701");
  await expect(panel.getByLabel("Country to send it to")).toHaveValue("US");
  await panel.getByRole("button", { name: "Order a sample" }).click();
  await expect(panel.getByRole("status")).toContainText("Sample ordered.");
  await expect(panel.getByRole("list", { name: "Samples" }).getByRole("listitem")).toHaveCount(1);
  // The demo supplier hands it to the courier at once, so tracking already shows.
  await expect(panel.getByRole("list", { name: "Samples" })).toContainText(/On the way · Demo Post DS\d+/);

  // It's not an order.
  await page.goto("/admin/orders");
  await expect(page.getByRole("row", { name: /#1001/ })).toHaveCount(0);
});
