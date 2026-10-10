import { expect, test, type Page } from "@playwright/test";

// Order notes and tags: the buyer leaves a note at checkout, and the merchant sees it, adds their
// own note and tags, and finds the order again by tag or search.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer's note, and the merchant's note and tags", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`on-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`grace-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Grace Hopper");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByLabel("Note for the store (optional)").fill("Please leave it with the neighbour.");
  await shot(buyer, "241-checkout-note");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();
  await expect(buyer.getByRole("region", { name: "Your note to the store" })).toContainText("Please leave it with the neighbour.");

  // The merchant sees the note in the list and on the order, and adds their own.
  await page.goto("/admin/orders");
  const row = page.getByRole("row").filter({ hasText: "#1001" });
  await expect(row.getByText("Has a note")).toBeVisible();
  await row.getByRole("link", { name: "#1001" }).click();
  await expect(page.getByRole("region", { name: "Note from the customer" })).toContainText("Please leave it with the neighbour.");
  const notes = page.getByRole("region", { name: "Your note and tags" });
  await notes.getByLabel("Tags").fill("Follow up, VIP");
  await notes.getByLabel("Note").fill("Check the neighbour's name with them.");
  await notes.getByRole("button", { name: "Save note and tags" }).click();
  await expect(notes.getByText("Saved.")).toBeVisible();
  await expect(notes.getByLabel("Tags")).toHaveValue("follow up, vip");
  await shot(page, "242-order-notes");

  // Tags filter the list, and search finds orders by name.
  await page.goto("/admin/orders");
  const tags = page.getByRole("navigation", { name: "Filter by tag" });
  await tags.getByRole("link", { name: /follow up/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "#1001" })).toContainText("follow up");
  await page.getByLabel("Search orders").fill("nobody here");
  await page.getByRole("search").getByRole("button", { name: "Search" }).click();
  await expect(page.getByText('No orders match "nobody here".')).toBeVisible();
  await page.getByLabel("Search orders").fill("grace");
  await page.getByRole("search").getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name: "#1001" })).toBeVisible();
  await shot(page, "243-order-tags-filter");
});
