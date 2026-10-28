import { expect, test } from "@playwright/test";

// The product list filtered to products that earn little: under 20% of the price after its cost,
// or below cost. Only shown while some product does.

test("a merchant finds products that sell below cost", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pm-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Margins ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Margins/ })).toBeVisible();
  for (const [title, price, cost] of [["Gift Mug", "20.00", "8.00"], ["Plain Tee", "10.00", "12.00"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByLabel("Your cost", { exact: true }).fill(cost);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }

  await page.goto("/admin/products");
  const listed = () => page.getByRole("checkbox", { name: /^Select (?!all)/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace("Select ", "")));
  await expect.poll(listed).toEqual(["Plain Tee", "Gift Mug"]);
  const margin = page.getByRole("navigation", { name: "Filter by margin" });
  await expect(margin.getByRole("link", { name: "Under 20% 1" })).toBeVisible();
  await margin.getByRole("link", { name: "Below cost 1" }).click();
  await expect(page).toHaveURL(/margin=loss/);
  await expect.poll(listed).toEqual(["Plain Tee"]);
  await expect(page.getByText(/sells for less than it costs/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Download these products/ })).toHaveAttribute("href", /margin=loss/);
});
