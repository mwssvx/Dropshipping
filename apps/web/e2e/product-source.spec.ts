import { expect, test } from "@playwright/test";

// Filtering the product list by where products come from: a supplier or the store's own stock.

test("a merchant lists supplier products apart from their own", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`src-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Source ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Source/ })).toBeVisible();
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Own Mug");
  await page.getByLabel("Price", { exact: true }).fill("20.00");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();

  // With products from one place only, there's nothing to filter.
  await page.goto("/admin/products");
  await expect(page.getByRole("navigation", { name: "Filter by source" })).toHaveCount(0);

  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();

  await page.goto("/admin/products");
  const listed = () => page.getByRole("checkbox", { name: /^Select (?!all)/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace("Select ", "")));
  await expect.poll(listed).toHaveLength(2);
  const source = page.getByRole("navigation", { name: "Filter by source" });
  await expect(source.getByRole("link", { name: "From suppliers 1" })).toBeVisible();
  await source.getByRole("link", { name: /Your own stock/ }).click();
  await expect(page).toHaveURL(/source=own/);
  await expect.poll(listed).toEqual(["Own Mug"]);
  await source.getByRole("link", { name: /From suppliers/ }).click();
  await expect(page).toHaveURL(/source=supplier/);
  await expect.poll(listed).toEqual([expect.stringMatching(/Sunset Projection Lamp/i)]);
  const href = await page.getByRole("link", { name: "Download these products as a spreadsheet" }).getAttribute("href");
  expect(href).toContain("source=supplier");
  const csv = await (await page.request.get(href!)).text();
  expect(csv).toMatch(/Sunset Projection Lamp/i);
  expect(csv).not.toContain("Own Mug");
});
