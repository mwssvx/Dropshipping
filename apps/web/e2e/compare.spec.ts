import { expect, test, type Page } from "@playwright/test";

// Compare: shoppers put up to four products side by side, with the merchant's details lined up by label.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a shopper compares two products side by side", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cmp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Compare ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Compare/ })).toBeVisible();
  const links: string[] = [];
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    links.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  }
  // The stand (last imported) gets a details table.
  const section = page.getByRole("region", { name: "Details", exact: true });
  await section.getByLabel("Details", { exact: true }).fill("Material: Aluminium\nWeight: 120 g");
  await section.getByRole("button", { name: "Save details" }).click();
  await expect(section.getByText(/^Saved\. 2 details/)).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(links[0]!);
  const form = buyer.locator("#compare");
  await form.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(form.getByText("Added to compare.")).toBeVisible();
  await expect(form.getByRole("button", { name: "Remove from compare" })).toHaveAttribute("aria-pressed", "true");
  await buyer.goto(links[1]!);
  await form.getByRole("button", { name: "Compare", exact: true }).click();
  await form.getByRole("link", { name: "Compare (2)" }).click();

  await expect(buyer.getByRole("heading", { name: "Compare products" })).toBeVisible();
  const table = buyer.getByRole("table", { name: "Compare products" });
  await expect(table.getByRole("columnheader")).toHaveCount(2);
  await expect(table.getByRole("row", { name: /^Availability/ })).toHaveText(/In stock.*In stock/);
  await expect(table.getByRole("row", { name: /^Material/ })).toHaveText("Material—Aluminium");
  await expect(table.getByRole("row", { name: /^Weight/ })).toHaveText("Weight—120 g");
  await expect(table.getByRole("row", { name: /^Price/ })).toContainText("$");
  await shot(buyer, "472-compare");

  await table.getByRole("button", { name: /^Remove Sunset Projection Lamp/i }).click();
  await expect(buyer.getByText("Add one more product to see them side by side.")).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(1);
  await buyer.getByRole("button", { name: "Clear all" }).click();
  await expect(buyer.getByText(/^Nothing to compare yet/)).toBeVisible();
});
