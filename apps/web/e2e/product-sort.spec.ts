import { expect, test } from "@playwright/test";

// Sorting the product list: by title or price, keeping the search and filters.

test("a merchant sorts the product list", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ps-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sorting ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sorting/ })).toBeVisible();
  for (const [title, price] of [["Zebra Mug", "40.00"], ["Apple Mug", "25.00"], ["Moon Cap", "15.00"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }

  await page.goto("/admin/products");
  const order = () => page.getByRole("checkbox", { name: /^Select (?!all)/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace("Select ", "")));
  await expect.poll(order).toEqual(["Moon Cap", "Apple Mug", "Zebra Mug"]);
  await page.getByLabel("Sort products").selectOption({ label: "Title A to Z" });
  await expect(page).toHaveURL(/sort=title/);
  await expect.poll(order).toEqual(["Apple Mug", "Moon Cap", "Zebra Mug"]);
  await page.getByLabel("Sort products").selectOption({ label: "Price, high to low" });
  await expect(page).toHaveURL(/sort=price_desc/);
  await expect.poll(order).toEqual(["Zebra Mug", "Apple Mug", "Moon Cap"]);
  // The search keeps the sort.
  await page.getByLabel("Search products").fill("mug");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=mug/);
  await expect(page).toHaveURL(/sort=price_desc/);
  await expect.poll(order).toEqual(["Zebra Mug", "Apple Mug"]);
  await expect(page.getByLabel("Sort products")).toHaveValue("price_desc");
});
