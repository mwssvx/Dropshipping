import { expect, test } from "@playwright/test";

// Downloading only the products the list shows, ready to change in a spreadsheet and upload back.

test("a merchant downloads just the sold-out products", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pcf-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sheet list ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sheet list/ })).toBeVisible();
  for (const [title, stock] of [["Gone Mug", "0"], ["Plenty Tee", "40"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("20.00");
    await page.getByLabel("Stock", { exact: true }).fill(stock);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }

  await page.goto("/admin/products");
  const titles = async () => {
    const href = await page.getByRole("link", { name: /as a spreadsheet$/ }).getAttribute("href");
    const csv = await (await page.request.get(href!)).text();
    return csv.trim().split("\n").slice(1).map((r) => r.split(",")[1]);
  };
  await expect(page.getByRole("link", { name: "Download all products as a spreadsheet" })).toBeVisible();
  expect((await titles()).sort()).toEqual(["Gone Mug", "Plenty Tee"]);
  await page.getByRole("navigation", { name: "Filter by stock" }).getByRole("link", { name: "Sold out" }).click();
  await expect(page).toHaveURL(/stock=sold_out/);
  await expect(page.getByRole("link", { name: "Download these products as a spreadsheet" })).toBeVisible();
  expect(await titles()).toEqual(["Gone Mug"]);
  await page.getByLabel("Search products").fill("tee");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/q=tee/);
  expect(await titles()).toEqual([]);
});
