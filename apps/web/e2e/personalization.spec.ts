import { expect, test, type Page } from "@playwright/test";

// Personalised products: the merchant adds text fields to a product, buyers fill them in before
// adding to cart, and the text shows in the cart, at checkout and on the order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("buyers personalise a product and the merchant sees the text", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pz-${id}@example.com`);
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

  // Two fields: a required name and an optional note. A blank label is caught and nothing is lost.
  const editor = page.getByRole("region", { name: "Personalisation" });
  await editor.getByRole("button", { name: "Add a field" }).click();
  await editor.getByRole("listitem", { name: "Field 1" }).getByLabel("Label").fill("Name to engrave");
  await editor.getByRole("listitem", { name: "Field 1" }).getByLabel("Max characters").fill("12");
  await editor.getByRole("button", { name: "Add a field" }).click();
  const second = editor.getByRole("listitem", { name: "Field 2" });
  await second.getByLabel("Required").uncheck();
  await editor.getByRole("button", { name: "Save personalisation" }).click();
  await expect(editor.getByRole("alert")).toContainText('Give each field a label, like "Name to engrave".');
  await expect(second.getByLabel("Required")).not.toBeChecked();
  await second.getByLabel("Label").fill("Gift note");
  await second.getByLabel("Max characters").fill("60");
  await editor.getByRole("button", { name: "Save personalisation" }).click();
  await expect(editor.getByText("Saved. Buyers fill these in on the product page before adding it to their cart.")).toBeVisible();
  await shot(page, "301-personalisation-settings");

  // The buyer has to fill in the name; the note is optional.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  const name = buyer.getByLabel("Name to engrave");
  await expect(name).toHaveAttribute("required", "");
  await expect(name).toHaveAttribute("maxlength", "12");
  await expect(buyer.getByText("Gift note (optional)")).toBeVisible();
  await name.fill("Ada");
  await buyer.getByLabel(/Gift note/).fill("Happy birthday!");
  await shot(buyer, "302-personalisation-product");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("heading", { name: "Your cart" })).toBeVisible();

  // The same lamp with another name is its own line.
  await buyer.goto(store);
  await buyer.getByLabel("Name to engrave").fill("Grace");
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  const items = buyer.getByRole("main").getByRole("listitem").filter({ hasText: "Name to engrave:" });
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("Name to engrave: Ada");
  await expect(items.first()).toContainText("Gift note: Happy birthday!");
  await expect(items.nth(1)).toContainText("Name to engrave: Grace");
  await shot(buyer, "303-personalisation-cart");

  // Changing one line's quantity leaves the other alone.
  await items.nth(1).getByRole("spinbutton").fill("2");
  await items.nth(1).getByRole("button", { name: "Update" }).click();
  await expect(items.nth(1).getByRole("spinbutton")).toHaveValue("2");
  await expect(items.first().getByRole("spinbutton")).toHaveValue("1");

  await buyer.getByRole("link", { name: "Check out" }).click();
  await expect(buyer.getByText("Name to engrave: Grace")).toBeVisible();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`ada-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Ada Lovelace");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await expect(buyer.getByText("Name to engrave: Ada · Gift note: Happy birthday!")).toBeVisible();

  // The merchant sees exactly what to engrave.
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).click();
  await expect(page).toHaveURL(/\/admin\/orders\/[^/]+$/);
  const texts = page.getByLabel("Personalisation");
  await expect(texts).toHaveCount(2);
  await expect(texts.first()).toContainText("Name to engrave: Ada");
  await expect(texts.nth(1)).toContainText("Name to engrave: Grace");
  await shot(page, "304-personalisation-order");
});
