import { expect, test } from "@playwright/test";

// Saved views: a named set of filters on the product or order list, one click away for the team.

test("a merchant saves a filtered list as a view and comes back to it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sv-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Views ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Views/ })).toBeVisible();
  for (const [title, stock] of [["Gone Mug", "0"], ["Plenty Tee", "40"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("20.00");
    await page.getByLabel("Stock", { exact: true }).fill(stock);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }

  await page.goto("/admin/products");
  // Nothing to save until the list is searched or filtered.
  await expect(page.getByText("Save this view")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Filter by stock" }).getByRole("link", { name: "Sold out" }).click();
  await expect(page).toHaveURL(/stock=sold_out/);
  await page.getByText("Save this view").click();
  await page.getByLabel("Name for this view").fill("Restock these");
  await page.getByRole("button", { name: "Save view" }).click();
  const views = page.getByRole("navigation", { name: "Saved views" });
  await expect(views.getByRole("link", { name: "Restock these" })).toHaveAttribute("aria-current", "page");

  await page.goto("/admin/products");
  const listed = () => page.getByRole("checkbox", { name: /^Select (?!all)/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace("Select ", "")));
  await expect.poll(listed).toEqual(["Plenty Tee", "Gone Mug"]);
  await views.getByRole("link", { name: "Restock these" }).click();
  await expect(page).toHaveURL(/stock=sold_out/);
  await expect.poll(listed).toEqual(["Gone Mug"]);

  // The order list keeps its own views.
  await page.goto("/admin/orders");
  await expect(page.getByRole("navigation", { name: "Saved views" })).toHaveCount(0);
  await page.getByRole("link", { name: /Needs attention/ }).click();
  await page.getByText("Save this view").click();
  await page.getByLabel("Name for this view").fill("Problems");
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByRole("navigation", { name: "Saved views" }).getByRole("link", { name: "Problems" })).toBeVisible();

  // Removing a view leaves the others.
  await page.goto("/admin/products");
  await views.getByRole("button", { name: "Remove the view Restock these" }).click();
  await expect(page.getByRole("navigation", { name: "Saved views" })).toHaveCount(0);
  await page.goto("/admin/orders");
  await expect(page.getByRole("navigation", { name: "Saved views" }).getByRole("link", { name: "Problems" })).toBeVisible();
});
