import { expect, test } from "@playwright/test";

// Filtering the product list by stock: sold out, running low or in stock, keeping the search.

test("a merchant finds sold-out and running-low products", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sf-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Stock list ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Stock list/ })).toBeVisible();
  for (const [title, stock] of [["Gone Mug", "0"], ["Last Few Cap", "2"], ["Plenty Tee", "40"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("20.00");
    await page.getByLabel("Stock", { exact: true }).fill(stock);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }

  await page.goto("/admin/products");
  const listed = () => page.getByRole("checkbox", { name: /^Select (?!all)/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace("Select ", "")));
  await expect.poll(listed).toEqual(["Plenty Tee", "Last Few Cap", "Gone Mug"]);
  const stock = page.getByRole("navigation", { name: "Filter by stock" });
  await stock.getByRole("link", { name: "Sold out" }).click();
  await expect(page).toHaveURL(/stock=sold_out/);
  await expect.poll(listed).toEqual(["Gone Mug"]);
  await stock.getByRole("link", { name: "Running low" }).click();
  await expect(page).toHaveURL(/stock=low/);
  await expect.poll(listed).toEqual(["Last Few Cap"]);
  await expect(page.getByText("Still for sale, with an option at 3 or fewer left.")).toBeVisible();
  await stock.getByRole("link", { name: "In stock" }).click();
  await expect.poll(listed).toEqual(["Plenty Tee", "Last Few Cap"]);
  // The search keeps the stock filter, and clicking the chip again clears it.
  await page.getByLabel("Search products").fill("tee");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=tee/);
  await expect(page).toHaveURL(/stock=in_stock/);
  await expect.poll(listed).toEqual(["Plenty Tee"]);
  await stock.getByRole("link", { name: "In stock" }).click();
  await expect(page).not.toHaveURL(/stock=/);
  await expect(stock.getByRole("link", { name: "In stock" })).not.toHaveAttribute("aria-current", "page");
});
