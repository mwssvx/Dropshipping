import { expect, test } from "@playwright/test";

// The header's search button opens a search box under the header on any store page, with
// suggestions as the shopper types.

test("shoppers search from the header on any page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`hs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Header ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Header/ })).toBeVisible();
  for (const [title, price] of [["Walnut Desk Lamp", "45.00"], ["Linen Cushion", "20.00"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  const button = buyer.getByRole("banner").getByRole("link", { name: "Search", exact: true });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const box = buyer.getByRole("combobox", { name: "Search" });
  await expect(box).toBeFocused();
  // Escape puts it away and hands focus back.
  await box.press("Escape");
  await expect(box).toHaveCount(0);
  await expect(button).toBeFocused();

  await button.click();
  await buyer.mouse.move(1, 1);
  await buyer.getByRole("combobox", { name: "Search" }).pressSequentially("walnut");
  const list = buyer.getByRole("listbox", { name: "Suggestions" });
  await expect(list.getByRole("option")).toHaveText([/^Walnut Desk Lamp\$45\.00/, "See all results for “walnut”"]);
  await list.getByRole("option", { name: /Walnut Desk Lamp/ }).click();
  await expect(buyer).toHaveURL(/\/products\/walnut-desk-lamp$/);

  // Enter runs the whole search.
  await button.click();
  await buyer.getByRole("combobox", { name: "Search" }).fill("cushion");
  await buyer.getByRole("combobox", { name: "Search" }).press("Enter");
  await expect(buyer.getByRole("heading", { name: "Results for “cushion”" })).toBeVisible();
  await expect(buyer.locator("main .sf-card")).toContainText("Linen Cushion");
  await buyer.context().close();
});
