import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// With the theme setting on, every store page's footer asks for an email, and the shopper signs
// up without leaving the page they were on.

test("a shopper signs up for emails from the footer of a product page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`foot-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Foot ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Foot/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const footer = buyer.getByRole("contentinfo");
  // Off by default.
  await buyer.goto(product);
  await expect(footer.getByRole("heading", { name: "Get news and offers by email" })).toHaveCount(0);

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Ask for emails in the footer of every page").check();
  // The preview shows it, with nothing to send.
  await expect(preview.getByRole("contentinfo").getByRole("button", { name: "Sign up" })).toBeDisabled();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await buyer.reload();
  await expect(footer.getByRole("heading", { name: "Get news and offers by email" })).toBeVisible();
  const result = await new AxeBuilder({ page: buyer }).include(".sf-footer-signup").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await footer.getByLabel("Email for news and offers").fill(`buyer-${id}@example.com`);
  await footer.getByRole("button", { name: "Sign up" }).click();
  await expect(footer.getByRole("status")).toHaveText("Check your inbox: click the link we sent to confirm.");
  // Still on the product page.
  await expect(buyer).toHaveURL(new RegExp(`${product.replace(/[/.]/g, "\\$&")}$`));
  await buyer.context().close();
});
