import { expect, test, type Page } from "@playwright/test";

// Bundles: the merchant sells a lamp and a projector together for less, a buyer adds both from
// the lamp's page in one click and sees the saving in their cart and on the order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

/** Picks the option whose text matches, without knowing its exact wording. */
async function pick(page: Page, label: string, text: RegExp) {
  const select = page.getByLabel(label);
  const value = await select.locator("option").filter({ hasText: text }).first().getAttribute("value");
  await select.selectOption(value!);
}

test("a merchant makes a bundle and a buyer gets it in one click", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`bundle-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Bundler ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Bundler/ })).toBeVisible();
  let lampLink = "";
  for (const name of [/sunset projection lamp/i, /galaxy projector low stock/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    lampLink ||= (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  }

  // The merchant makes a bundle.
  await page.goto("/admin/bundles");
  await page.getByLabel("Name").fill("Night set");
  await pick(page, "Product 1", /sunset/i);
  await pick(page, "Product 2", /galaxy/i);
  await page.getByLabel("Discount (%)").fill("20");
  await page.getByRole("button", { name: "Add bundle" }).click();
  await expect(page.getByText("Bundle added. It shows on each of its products' pages.")).toBeVisible();
  const row = page.getByRole("listitem", { name: "Night set" });
  await expect(row).toContainText("save 20%");
  await expect(row).toContainText("On the store");
  await shot(page, "129-bundles");

  // A buyer adds both from the lamp's page, picking the large lamp.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lampLink);
  const bundle = buyer.getByRole("region", { name: "Buy together, save 20%" });
  await expect(bundle).toContainText("Night set");
  await bundle.getByLabel(/Option for Sunset Projection Lamp/).selectOption({ label: "Large" });
  await shot(buyer, "130-bundle-on-product");
  await bundle.getByRole("button", { name: "Add all 2 to cart" }).click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.getByRole("link", { name: /Sunset Projection Lamp – Large/ })).toBeVisible();
  await expect(buyer.getByRole("link", { name: /Galaxy Projector/ })).toBeVisible();
  await expect(buyer.getByText("Bundle (Night set)")).toBeVisible();
  await shot(buyer, "131-bundle-in-cart");

  // Taking the projector out ends the saving.
  const projectorRow = buyer.getByRole("listitem").filter({ hasText: /Galaxy Projector/ });
  await projectorRow.getByLabel("Quantity").fill("0");
  await projectorRow.getByRole("button", { name: "Update" }).click();
  await expect(buyer.getByText("Bundle (Night set)")).toHaveCount(0);

  // Turned off, it leaves the product page.
  await row.getByRole("button", { name: "Turn off" }).click();
  await expect(row).toContainText("Off");
  await buyer.goto(lampLink);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByRole("region", { name: "Buy together, save 20%" })).toHaveCount(0);
});
