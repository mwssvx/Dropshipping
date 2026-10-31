import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Asking visitors their age before they see a store that sells only to adults. A "yes" is
// remembered on the device; a "no" leaves the store hidden; the editor preview never asks.

test("an adults-only store asks visitors their age once", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`wine-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Wine ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Wine/ })).toBeVisible();
  const handle = `wine-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Ask visitors their age first").selectOption("21");
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await expect(preview.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  const gate = buyer.getByRole("dialog", { name: `Wine ${id}` });
  await expect(gate).toBeVisible();
  await expect(gate).toHaveAccessibleDescription(`You must be old enough to buy from Wine ${id}.`);
  await expect(gate.getByText("Are you 21 or older?")).toBeVisible();
  const result = await new AxeBuilder({ page: buyer }).include(".sf-age-gate").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  // Escape doesn't get past it.
  await buyer.keyboard.press("Escape");
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "No" }).click();
  await expect(gate.getByText("Sorry, you need to be 21 or older to visit this store.")).toBeVisible();
  await expect(gate.getByRole("button")).toHaveCount(0);

  // Asked again after a reload; a yes is remembered on every page after that.
  await buyer.reload();
  await expect(gate).toBeVisible();
  await gate.getByRole("button", { name: "Yes, I'm 21 or older" }).click();
  await expect(gate).toHaveCount(0);
  await buyer.goto(`/s/${handle}/contact`);
  await expect(buyer.getByRole("heading", { name: "Contact us" })).toBeVisible();
  await expect(buyer.getByRole("dialog")).toHaveCount(0);
  await buyerContext.close();
});
