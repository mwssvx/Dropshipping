import { expect, test } from "@playwright/test";

// Emailing a restock order: the merchant sends the order to their supplier as a purchase order,
// and the supplier's reply comes back to the merchant.

test("a restock order emailed to the supplier", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const owner = `re-${id}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(owner);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Wool ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Wool/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Wool Scarf");
  await page.getByLabel("Price", { exact: true }).fill("40.00");
  await page.getByLabel("Stock", { exact: true }).fill("1");
  await page.getByLabel("SKU", { exact: true }).fill("SCARF-1");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  await page.goto("/admin/restock/new");
  await page.getByLabel("Ordered from").fill("Highland Mill");
  await page.getByLabel("Supplier's email (optional)").fill(`mill-${id}@example.com`);
  await page.getByLabel("How many Wool Scarf").fill("12");
  await page.getByLabel("Cost of each Wool Scarf").fill("9.50");
  await page.getByRole("button", { name: "Save restock order" }).click();
  await expect(page.getByRole("heading", { name: "Restock #1" })).toBeVisible();

  const send = page.getByRole("region", { name: "Send it to Highland Mill" });
  await expect(send.getByLabel("Send to")).toHaveValue(`mill-${id}@example.com`);
  await send.getByRole("button", { name: "Email this order" }).click();
  await expect(send.getByRole("status")).toHaveText(`Sent to mill-${id}@example.com. Their reply comes to ${owner}.`);
  await send.getByRole("button", { name: "Email this order" }).click();
  await expect(send.getByRole("alert")).toContainText("It was just sent.");

  await page.goto("/dev/mail");
  const letter = page.getByRole("article").filter({ hasText: `mill-${id}@example.com` }).first();
  await expect(letter.getByRole("heading")).toHaveText(`Purchase order #1 from Wool ${id}`);
  await expect(letter).toContainText("- 12 x Wool Scarf (SKU SCARF-1) at $9.50 each = $114.00");
});
