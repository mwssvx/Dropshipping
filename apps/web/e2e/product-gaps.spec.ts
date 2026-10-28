import { expect, test } from "@playwright/test";

// The product list filtered to what products still lack: a photo, a description, a weight for
// shipping rates or customs details. Only shown while some product lacks it.

test("a merchant finds products with no description", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pg-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Gaps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Gaps/ })).toBeVisible();
  for (const [title, description] of [["Gift Mug", "A big mug for big mornings."], ["Plain Tee", ""]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    if (description) await page.getByLabel("Description").fill(description);
    await page.getByLabel("Price", { exact: true }).fill("15.00");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }

  await page.goto("/admin/products");
  const listed = () => page.getByRole("checkbox", { name: /^Select (?!all)/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace("Select ", "")));
  await expect.poll(listed).toEqual(["Plain Tee", "Gift Mug"]);
  const missing = page.getByRole("navigation", { name: "Filter by what's missing" });
  await expect(missing.getByRole("link", { name: "No photo 2" })).toBeVisible();
  await missing.getByRole("link", { name: "No description 1" }).click();
  await expect(page).toHaveURL(/missing=description/);
  await expect.poll(listed).toEqual(["Plain Tee"]);
  await expect(missing.getByRole("link", { name: "No description 1" })).toHaveAttribute("aria-current", "page");
  const download = page.getByRole("link", { name: /Download these products/ });
  await expect(download).toHaveAttribute("href", /missing=description/);
  const csv = await (await page.request.get((await download.getAttribute("href"))!)).text();
  expect(csv).toContain("Plain Tee");
  expect(csv).not.toContain("Gift Mug");

  // Clicking it again clears the filter.
  await missing.getByRole("link", { name: "No description 1" }).click();
  await expect.poll(listed).toEqual(["Plain Tee", "Gift Mug"]);
});
