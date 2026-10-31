import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Notes the merchant writes once (shipping, returns) show under every product's description and
// open when tapped.

test("a merchant writes notes once and every product shows them", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`notes-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Notes ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Notes/ })).toBeVisible();
  const stores: string[] = [];
  for (const title of ["Desk Plant", "Clay Pot"]) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("12.00");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
    stores.push((await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!);
  }

  await page.goto("/admin/products");
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Notes under every product" }) });
  // Text without a title isn't saved.
  await panel.getByLabel("Text 1").fill("Ships in 2 days.");
  await panel.getByRole("button", { name: "Save notes" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Give each note a title, like “Shipping”.");
  await panel.getByLabel("Title 1").fill("Shipping");
  await panel.getByLabel("Text 1").fill("Ships in 2 days.\nFree over $50.");
  await panel.getByLabel("Title 3").fill("Returns");
  await panel.getByLabel("Text 3").fill("30 days, free.");
  await panel.getByRole("button", { name: "Save notes" }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved. Every product page shows these notes now.");
  // The empty second row closes up.
  await page.reload();
  await expect(panel.getByLabel("Title 2")).toHaveValue("Returns");
  await expect(panel.getByLabel("Title 3")).toHaveValue("");

  const context = await browser.newContext({ ...info.project.use });
  const buyer = await context.newPage();
  for (const store of stores) {
    await buyer.goto(store);
    const notes = buyer.locator(".sf-product-info details");
    await expect(notes.locator("summary")).toHaveText([/^Shipping\b/, /^Returns\b/]);
    await expect(buyer.getByText("30 days, free.")).toBeHidden();
  }
  await buyer.getByText("Returns", { exact: true }).click();
  await expect(buyer.getByText("30 days, free.")).toBeVisible();
  await expect(buyer.getByText("Free over $50.")).toBeHidden();
  const result = await new AxeBuilder({ page: buyer }).include(".sf-product-info").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await context.close();
});
