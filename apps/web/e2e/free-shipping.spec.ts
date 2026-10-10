import { expect, test, type Page } from "@playwright/test";

// Free-shipping goal: the cart says how much more gets free shipping, and celebrates once it's reached.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the cart shows how far it is from free shipping", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`fs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Freeship ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Freeship/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // The store uses the built-in rate: $4.99, free over $50. The lamp is $13.99.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await buyer.getByRole("link", { name: "Cart" }).first().click();
  await expect(buyer.getByText("You're $36.01 away from free shipping.")).toBeVisible();
  await expect(buyer.getByRole("progressbar", { name: "Progress to free shipping" })).toHaveAttribute("aria-valuenow", "28");
  await shot(buyer, "148-free-shipping-goal");

  await buyer.getByLabel("Quantity").fill("4");
  await buyer.getByRole("button", { name: "Update" }).click();
  await expect(buyer.getByText("Nice, you've got free shipping!")).toBeVisible();
  await expect(buyer.getByRole("progressbar", { name: "Progress to free shipping" })).toHaveAttribute("aria-valuenow", "100");
  await expect(buyer.getByRole("definition").filter({ hasText: /^Free$/ })).toBeVisible();
});
