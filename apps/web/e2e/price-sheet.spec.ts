import { expect, test, type Page } from "@playwright/test";

// Prices and stock from a spreadsheet: the merchant downloads their products, changes a price in
// the file, and uploads it again.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant changes prices by uploading their products file", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ps-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sheets ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sheets/ })).toBeVisible();
  for (const [title, price] of [["Linen Apron", "20.00"], ["Oven Glove", "8.00"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }

  // The download, with the apron's price changed and a row the store doesn't have.
  const file = await (await page.request.get("/admin/export/products.csv")).text();
  const lines = file.trim().split("\n");
  expect(lines[0]).toBe("Handle,Title,Status,Variant,SKU,Price,Compare at price,Cost,Stock,Image URL,Supplier link,Tags");
  const edited = [...lines.map((l) => (l.startsWith("linen-apron,") ? l.replace(",20.00,", ",24.50,") : l)), "no-such-thing,Ghost,active,Default,,9.00,,,,,"].join("\n");
  expect(edited).toContain(",24.50,");

  await page.goto("/admin/products");
  await page.getByText("Change prices and stock from a spreadsheet").click();
  const form = page.getByRole("form", { name: "Change prices and stock from a spreadsheet" });
  await form.getByLabel("Prices file (CSV)").setInputFiles({ name: "products.csv", mimeType: "text/csv", buffer: Buffer.from(edited) });
  await form.getByRole("button", { name: "Upload prices" }).click();
  const status = form.getByRole("status");
  await expect(status).toContainText("Changed 1 option. 1 option already matched the file.");
  await expect(status).toContainText("Line 4 (no-such-thing / Default): There's no product with this handle.");
  await shot(page, "414-price-sheet");

  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "Linen Apron" })).toContainText("$24.50");
  await expect(page.getByRole("row").filter({ hasText: "Oven Glove" })).toContainText("$8.00");
});
