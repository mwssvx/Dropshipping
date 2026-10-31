import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Products with a few options at one price get a picker on their card, so shoppers add a size
// without opening the product page. Different prices still go to the page.

async function product(page: Page, title: string, sizes: string, price: (row: string) => string | null, soldOut?: string) {
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Price", { exact: true }).fill("20.00");
  await page.getByRole("button", { name: "Add options like size or colour" }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Size");
  await page.getByLabel("Option 1 values, separated by commas").fill(sizes);
  for (const size of sizes.split(", ")) {
    const row = page.getByRole("group", { name: size, exact: true });
    const p = price(size);
    if (p) await row.getByLabel("Price", { exact: true }).fill(p);
    await row.getByLabel("Stock").fill(size === soldOut ? "0" : "5");
  }
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  return (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
}

test("a shopper picks a size on a product card and adds it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`picks-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Picks ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Picks/ })).toBeVisible();
  await product(page, "Plain Tee", "S, M, L", () => null, "M");
  const store = await product(page, "Framed Print", "A4, A3", (s) => (s === "A3" ? "30.00" : null));
  const all = store.replace(/\/products\/.*$/, "/collections/all");

  const context = await browser.newContext({ ...info.project.use });
  const buyer = await context.newPage();
  await buyer.goto(all);
  const pick = buyer.getByLabel("Choose an option for Plain Tee");
  await expect(pick).toHaveValue(/.+/);
  await expect(pick.locator("option")).toHaveText(["S", "M (Sold out)", "L"]);
  await expect(pick.locator("option", { hasText: "M (Sold out)" })).toHaveJSProperty("disabled", true);
  // Sizes at different prices are chosen on the product page.
  await expect(buyer.getByLabel("Choose an option for Framed Print")).toHaveCount(0);
  await expect(buyer.getByRole("button", { name: /^Add to cart/ })).toHaveCount(1);
  const result = await new AxeBuilder({ page: buyer }).include(".sf-quick-pick").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);

  await pick.selectOption({ label: "L" });
  await buyer.getByRole("button", { name: "Add to cart: Plain Tee" }).click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.locator("main").getByText(/Plain Tee.*L/).first()).toBeVisible();
  await context.close();
});
