import { expect, test } from "@playwright/test";

// Restock orders: the merchant writes down what they ordered for their own stock, sees it on the
// way on the product, and receives it in parts. It goes on the count with the cost paid.

test("a restock order arrives in two parts and goes on the stock count", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Aprons ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Aprons/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Linen Apron");
  await page.getByLabel("Price", { exact: true }).fill("28.00");
  await page.getByLabel("Stock", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const product = page.url().split("?")[0]!;

  await page.goto("/admin/restock");
  await expect(page.getByText("No restock orders yet.")).toBeVisible();
  await page.getByRole("link", { name: "New restock order" }).click();
  await page.getByLabel("Ordered from").fill("Flax Mill");
  await page.getByLabel("How many Linen Apron").fill("10");
  await page.getByLabel("Cost of each Linen Apron").fill("6.00");
  await page.getByRole("button", { name: "Save restock order" }).click();
  await expect(page.getByRole("heading", { name: "Restock #1" })).toBeVisible();
  await expect(page.getByText("Saved. Receive it here when it arrives.")).toBeVisible();
  const restock = page.url().split("?")[0]!;

  await page.goto(product);
  await expect(page.getByRole("region", { name: "On the way" })).toContainText("10 on restock #1");

  // Four came first.
  await page.goto(restock);
  await page.getByLabel("Linen Apron arrived").fill("4");
  await page.getByRole("button", { name: "Add to stock" }).click();
  await expect(page.getByText("Added 4 to your stock. The rest is still on the way.")).toBeVisible();
  await expect(page.getByLabel("Linen Apron arrived")).toHaveValue("6");
  await page.getByRole("button", { name: "Add to stock" }).click();
  // Once everything is in, the page says so in place of the form.
  await expect(page.getByText(/^Everything arrived on/)).toBeVisible();

  await page.goto(product);
  await expect(page.getByLabel("Stock", { exact: true })).toHaveValue("12");
  await expect(page.getByLabel("Your cost")).toHaveValue("6.00");
  await expect(page.getByRole("region", { name: "On the way" })).toHaveCount(0);
  await page.getByText("Stock history").click();
  await expect(page.getByRole("link", { name: "restock #1" }).first()).toBeVisible();

  await page.goto("/admin/restock");
  await expect(page.getByRole("listitem", { name: "Restock #1" })).toContainText("10 of 10 arrived");
  await expect(page.getByRole("listitem", { name: "Restock #1" })).toContainText("Arrived");
});
