import { expect, test } from "@playwright/test";

// Store search also finds collections, pages and blog posts by their title, on the results page
// and as the buyer types.

test("searching the store finds collections and pages too", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Found ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Found/ })).toBeVisible();
  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Brass Desk Lamp");
  await page.getByLabel("Price", { exact: true }).fill("40.00");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
  await page.goto("/admin/collections/new");
  await page.getByLabel("Title").fill("Desk lamps");
  await page.getByRole("button", { name: /Brass Desk Lamp/ }).click();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto("/admin/pages");
  await page.getByRole("region", { name: "Store policies" }).getByRole("button", { name: "Add policy pages" }).click();
  await expect(page.getByText(/^Added .*Shipping/)).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${store}/search?q=shipping`);
  const pages = buyer.getByRole("main").locator("section").filter({ has: buyer.getByRole("heading", { name: "Pages and articles" }) });
  await pages.getByRole("link", { name: "Shipping", exact: true }).click();
  await expect(buyer).toHaveURL(/\/pages\/shipping$/);

  await buyer.goto(`${store}/search?q=desk+lamp`);
  const collections = buyer.getByRole("main").locator("section").filter({ has: buyer.getByRole("heading", { name: "Collections" }) });
  await expect(collections.getByRole("link")).toHaveText(["Desk lamps"]);
  await expect(buyer.locator("main .sf-card")).toContainText("Brass Desk Lamp");

  // As the buyer types: products first, then collections and pages.
  await buyer.goto(`${store}/search`);
  // Out of the way of the list, which picks the row under the pointer.
  await buyer.mouse.move(1, 1);
  const box = buyer.getByRole("combobox", { name: "Search" });
  const answered = buyer.waitForResponse((r) => r.url().includes("/search/suggest?q=desk"));
  await box.pressSequentially("desk");
  await answered;
  const list = buyer.getByRole("listbox", { name: "Suggestions" });
  await expect(list.getByRole("option")).toHaveText([/^Brass Desk Lamp\$40\.00/, "Desk lampsCollection", "See all results for “desk”"]);
  await box.press("ArrowDown");
  await box.press("ArrowDown");
  await expect(list.getByRole("option", { name: /^Desk lamps/ })).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(buyer).toHaveURL(/\/collections\/desk-lamps$/);
  await buyer.context().close();
});
