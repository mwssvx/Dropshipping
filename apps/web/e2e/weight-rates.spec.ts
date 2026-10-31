import { expect, test } from "@playwright/test";

// Shipping by weight: products carry what they weigh, and a rate can be limited to carts up to a
// weight, so a heavy cart doesn't get the small-parcel price.

test("a small-parcel rate shows for a light cart and goes away for a heavy one", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`wr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Pottery ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Pottery/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Stoneware Bowl");
  await page.getByLabel("Price", { exact: true }).fill("22.00");
  await page.getByLabel("Weight (g)").fill("800");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  await expect(page.getByLabel("Weight (g)")).toHaveValue("800");
  const bowl = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  await page.getByRole("button", { name: "Set up shipping zones" }).click();
  const us = page.getByRole("listitem", { name: "United States zone" });
  await us.getByText("Add a rate").click();
  await us.getByLabel("Rate name").fill("Small parcel");
  await us.getByLabel(/^Price/).fill("3.00");
  await us.getByText("Only for some order weights").click();
  await us.getByLabel("Up to (kg)").fill("2");
  await us.getByRole("button", { name: "Add rate" }).click();
  await expect(us.getByRole("listitem", { name: "United States: Small parcel" })).toContainText("orders up to 2 kg");
  // The bowl has a weight, so there's nothing to warn about.
  await expect(page.getByRole("note", { name: "Products with no weight" })).toHaveCount(0);

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(bowl);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  const small = buyer.getByRole("radio", { name: /Small parcel/ });
  await expect(small).toBeChecked();
  await expect(buyer.locator("aside")).toContainText("Shipping (Small parcel)$3.00");

  // Three bowls weigh 2.4 kg: over the small parcel's limit.
  await buyer.goto(bowl.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByLabel("Quantity").fill("3");
  await buyer.getByRole("button", { name: "Update" }).click();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByRole("radio", { name: /Standard/ })).toBeVisible();
  await expect(small).toHaveCount(0);
  await expect(buyer.locator("aside")).toContainText("Shipping (Standard)");

  // A vase saved without a weight would ship for the small-parcel price: the Shipping page says so.
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Clay Vase");
  await page.getByLabel("Price", { exact: true }).fill("30.00");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  await page.goto("/admin/shipping");
  const note = page.getByRole("note", { name: "Products with no weight" });
  await expect(note).toContainText("1 product has an option with no weight");
  await note.getByRole("link", { name: "Give them a weight" }).click();
  await expect(page).toHaveURL(/missing=weight/);
  await expect(page.getByRole("link", { name: "Clay Vase" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Stoneware Bowl" })).toHaveCount(0);
});
