import { expect, test } from "@playwright/test";

// A collection's own order: the merchant picks how its page sorts products, and shoppers can still
// pick another order, the merchant's own included.

test("a collection lists its products in the order the merchant picked", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Sorted ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Sorted/ })).toBeVisible();
  let store = "";
  for (const [title, price] of [["Grand Lamp", "90.00"], ["Little Mug", "9.00"]] as const) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill(price);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }

  await page.goto("/admin/collections/new");
  await page.getByLabel("Title").fill("Gifts");
  await page.getByRole("button", { name: /Grand Lamp/ }).click();
  await page.getByRole("button", { name: /Little Mug/ }).click();
  await page.getByLabel("Sort products by").selectOption({ label: "Price, low to high" });
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByLabel("Sort products by")).toHaveValue("price_asc");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const cards = buyer.locator("main .sf-card");
  await buyer.goto(store.replace(/\/products\/.*$/, "/collections/gifts"));
  await expect(cards.first()).toContainText("Little Mug");
  // The merchant's pick is the page's own order; their hand-made order is still a choice.
  const sort = buyer.getByLabel("Sort by");
  await expect(sort.locator("option:checked")).toHaveText("Price, low to high");
  await sort.selectOption({ label: "Featured" });
  await buyer.getByRole("button", { name: "Apply" }).click();
  await expect(buyer).toHaveURL(/sort=featured/);
  await expect(cards.first()).toContainText("Grand Lamp");
  await buyer.context().close();
});
