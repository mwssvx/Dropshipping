import { expect, test, type Page } from "@playwright/test";

// Product details: short facts the merchant writes one per line, shown as a table on the product
// page and given to search engines.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the merchant adds details and buyers see them as a table", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`details-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Details ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Details/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const section = page.getByRole("region", { name: "Details", exact: true });
  const box = section.getByLabel("Details", { exact: true });
  await box.fill("Material: Aluminium\nComes with a remote");
  await section.getByRole("button", { name: "Save details" }).click();
  await expect(section.getByText('Line 2 needs a label and a value with a colon between them, like "Material: Aluminium".')).toBeVisible();
  // The box keeps what was typed after an error.
  await expect(box).toHaveValue("Material: Aluminium\nComes with a remote");
  await box.fill("Material: Aluminium\nIn the box: Lamp, remote, USB-C cable\nPower: 5 V, 2 A");
  await section.getByRole("button", { name: "Save details" }).click();
  await expect(section.getByText("Saved. 3 details show under the description on the product page.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  const table = buyer.getByRole("region", { name: "Details", exact: true });
  await expect(table.getByRole("row")).toHaveText(["MaterialAluminium", "In the boxLamp, remote, USB-C cable", "Power5 V, 2 A"]);
  await expect(table.getByRole("rowheader", { name: "Material" })).toBeVisible();
  const ld = JSON.parse((await buyer.locator('script[type="application/ld+json"]').first().textContent())!);
  expect(ld.additionalProperty).toEqual([
    { "@type": "PropertyValue", name: "Material", value: "Aluminium" },
    { "@type": "PropertyValue", name: "In the box", value: "Lamp, remote, USB-C cable" },
    { "@type": "PropertyValue", name: "Power", value: "5 V, 2 A" },
  ]);
  await shot(buyer, "410-product-details");

  // Emptying the box removes the table.
  await box.fill("");
  await section.getByRole("button", { name: "Save details" }).click();
  await expect(section.getByText("Saved. This product has no details table.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByRole("region", { name: "Details", exact: true })).toHaveCount(0);
});
