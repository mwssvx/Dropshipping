import { expect, test, type Page } from "@playwright/test";

// Options editor: a product added by hand gets sizes and colours, and every combination becomes
// an option with its own price and stock.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant lists sizes and colours once and prices each combination", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`op-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Tees ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Tees/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Plain Tee");
  await page.getByLabel("Price", { exact: true }).fill("20.00");
  await page.getByRole("button", { name: "Add options like size or colour" }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Size");
  await page.getByLabel("Option 1 values, separated by commas").fill("S, M");
  await page.getByRole("button", { name: "Add another option" }).click();
  await page.getByLabel("Option 2", { exact: true }).fill("Color");
  await page.getByLabel("Option 2 values, separated by commas").fill("Black, White");
  await expect(page.getByText("4 combinations, each with its own price and stock below.")).toBeVisible();
  const row = (title: string) => page.getByRole("group", { name: title, exact: true });
  // New combinations start from the first price.
  await expect(row("S / Black").getByLabel("Price", { exact: true })).toHaveValue("20.00");
  await row("M / White").getByLabel("Price", { exact: true }).fill("22.00");
  await row("M / White").getByLabel("Stock").fill("0");
  await shot(page, "201-options-editor");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  // Back on the product: the options are as saved. Dropping White keeps the black ones.
  await expect(row("M / White").getByLabel("Price", { exact: true })).toHaveValue("22.00");
  await row("M / Black").getByLabel("Stock").fill("7");
  await page.getByLabel("Option 2 values, separated by commas").fill("Black");
  await expect(page.getByText("2 combinations, each with its own price and stock below.")).toBeVisible();
  await expect(row("M / White")).toHaveCount(0);
  await expect(row("M / Black").getByLabel("Stock")).toHaveValue("7");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/^Saved\./).first()).toBeVisible();
  await expect(page.getByRole("group", { name: /\/ / })).toHaveCount(2);
  await expect(row("M / Black").getByLabel("Stock")).toHaveValue("7");

  // Shoppers see the options, and filtered pages know the sizes.
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  await page.goto(store);
  const size = page.getByRole("group", { name: /^Size:/ });
  await expect(size).toHaveAccessibleName("Size: S");
  await size.getByText("M", { exact: true }).click();
  await expect(size).toHaveAccessibleName("Size: M");
  await expect(page.getByText("M / Black")).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText(/Plain Tee/).first()).toBeVisible();
  await expect(page.getByText("M / Black").first()).toBeVisible();
  const all = store.replace(/\/products\/.*$/, "/collections/all");
  await page.goto(`${all}?opt=Size:M`);
  await expect(page.getByRole("link", { name: /Plain Tee/ })).toBeVisible();
  await page.goto(`${all}?opt=Size:L`);
  await expect(page.getByText("Nothing matches those filters.")).toBeVisible();
});

test("a sold-out combination moves the other choice to one in stock", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`os-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Socks ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Socks/ })).toBeVisible();
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Wool Socks");
  await page.getByLabel("Price", { exact: true }).fill("12.00");
  await page.getByRole("button", { name: "Add options like size or colour" }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Color");
  await page.getByLabel("Option 1 values, separated by commas").fill("Grey, Red");
  await page.getByRole("button", { name: "Add another option" }).click();
  await page.getByLabel("Option 2", { exact: true }).fill("Size");
  await page.getByLabel("Option 2 values, separated by commas").fill("S, L");
  const row = (title: string) => page.getByRole("group", { name: title, exact: true });
  // Red only comes in L, and L only in red.
  await row("Red / S").getByLabel("Stock").fill("0");
  await row("Grey / L").getByLabel("Stock").fill("0");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  await page.goto((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  const color = page.getByRole("group", { name: /^Color:/ });
  const size = page.getByRole("group", { name: /^Size:/ });
  await expect(color).toHaveAccessibleName("Color: Grey");
  await expect(size).toHaveAccessibleName("Size: S");
  await color.getByText("Red", { exact: true }).click();
  await expect(size).toHaveAccessibleName("Size: L");
  await expect(page.getByText("Red / L")).toBeVisible();
  await shot(page, "211-option-picker");
});
