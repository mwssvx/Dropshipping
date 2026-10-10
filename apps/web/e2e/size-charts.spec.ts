import { expect, test, type Page } from "@playwright/test";

// Size charts: the merchant makes a table (or has the AI draft one, hidden until checked),
// attaches it to a product, and buyers open it on the product page in cm or inches.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant makes a size chart and buyers switch it to inches", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`size-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Fits ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Fits/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // The AI drafts from the description; this one lists no measurements, so it asks to check.
  await page.goto("/admin/size-charts");
  await page.getByLabel("Product", { exact: true }).selectOption({ label: "Sunset Projection Lamp" });
  await page.getByRole("button", { name: "Draft with AI" }).click();
  await expect(page.getByText("Drafted from the product's description.")).toBeVisible();
  await expect(page.getByLabel("Note under the table")).toHaveValue(/^\[Check: /);
  await expect(page.getByLabel("Show on the store")).not.toBeChecked();
  await page.getByRole("link", { name: "← Size charts" }).click();
  await expect(page.getByRole("listitem", { name: /Sunset Projection Lamp sizes/ })).toContainText("Hidden");
  await page.getByRole("listitem", { name: /Sunset Projection Lamp sizes/ }).getByRole("link", { name: /^Edit/ }).click();
  await page.getByRole("button", { name: "Delete this size chart" }).click();
  await expect(page.getByText("None yet.")).toBeVisible();

  // One made by hand, attached to the lamp.
  await page.getByRole("link", { name: "New size chart" }).click();
  await page.getByLabel("Name").fill("T-shirts");
  await page.getByRole("button", { name: "Remove column Waist" }).click();
  await page.getByLabel("Chest for S").fill("86-91");
  await page.getByLabel("Length for S").fill("69");
  await page.getByLabel("Chest for M").fill("96-101");
  await page.getByRole("button", { name: "Save size chart" }).click();
  await expect(page.getByText("Size chart saved.")).toBeVisible();
  await page.getByRole("button", { name: "Add size" }).click();
  await page.getByLabel("Size for row 4").fill("XL");
  await page.getByLabel("Chest for XL").fill("112");
  await page.getByLabel("Sunset Projection Lamp").check();
  await page.getByRole("button", { name: "Save size chart" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. It shows on the products it's attached to." })).toBeVisible();
  await shot(page, "152-size-chart-editor");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  await buyer.getByRole("button", { name: "Size chart" }).click();
  const dialog = buyer.getByRole("dialog", { name: "Size chart: T-shirts" });
  await expect(dialog).toBeVisible();
  const xl = dialog.getByRole("row", { name: /XL/ });
  await expect(xl).toContainText("112");
  await expect(dialog.getByRole("columnheader", { name: "Chest (cm)" })).toBeVisible();
  await dialog.getByRole("button", { name: "Inches" }).click();
  await expect(dialog.getByRole("columnheader", { name: "Chest (in)" })).toBeVisible();
  await expect(dialog.getByRole("row", { name: /^S / })).toContainText("33.75-35.75");
  await expect(xl).toContainText("44");
  await shot(buyer, "153-size-chart-store");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});
