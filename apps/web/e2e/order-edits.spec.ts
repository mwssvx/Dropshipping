import { expect, test, type Page } from "@playwright/test";

// Changing an order before it ships: the buyer fixes their address and picks another size from
// their order page, and the merchant can do the same from the admin.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer changes their address and size, and the merchant sees it", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`oe-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Shirts ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Shirts/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Linen Shirt");
  await page.getByLabel("Price", { exact: true }).fill("30.00");
  await page.getByRole("button", { name: "Add options like size or colour" }).click();
  await page.getByLabel("Option 1", { exact: true }).fill("Size");
  await page.getByLabel("Option 1 values, separated by commas").fill("S, M");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
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
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();

  // The buyer typed the wrong street and wants a medium.
  const mine = buyer.getByRole("region", { name: "Change your order" });
  await mine.getByText("Wrong address, or need another size?").click();
  await expect(mine.getByText(/You can change it here until/)).toBeVisible();
  await mine.getByLabel("Street address").fill("9 Oak Ave");
  await mine.getByLabel("Linen Shirt – S").selectOption({ label: "M" });
  await shot(buyer, "221-buyer-order-edit");
  await mine.getByRole("button", { name: "Save changes" }).click();
  await expect(mine.getByText("Saved. We've emailed you the change.")).toBeVisible();
  await expect(buyer.getByText(/You changed this order on .*: New delivery address: 9 Oak Ave, Austin, 78701; Linen Shirt – S is now Linen Shirt – M\./)).toBeVisible();
  await expect(buyer.getByText("Linen Shirt – M × 1")).toBeVisible();

  // The merchant sees the change, and can switch the size back.
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
  await expect(page.getByText(/Changed by the customer: New delivery address: 9 Oak Ave/)).toBeVisible();
  await expect(page.getByText(/Order change email sent to grace-/)).toBeVisible();
  await expect(page.getByText("9 Oak Ave", { exact: false }).first()).toBeVisible();
  const change = page.getByRole("region", { name: "Change the order" });
  await change.getByText("Change the address or a size").click();
  await change.getByLabel("Linen Shirt – M").selectOption({ label: "S" });
  await change.getByRole("button", { name: "Save changes" }).click();
  // It isn't from a supplier, so there's no supplier order to redo.
  await expect(change.getByText("Saved and emailed to the customer.")).toBeVisible();
  await expect(page.getByText(/Changed by you: Linen Shirt – M is now Linen Shirt – S/)).toBeVisible();

  // Nothing new to save is said plainly.
  await change.getByRole("button", { name: "Save changes" }).click();
  await expect(change.getByRole("alert")).toContainText("Nothing changed.");
});
