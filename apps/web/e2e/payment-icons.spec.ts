import { expect, test } from "@playwright/test";

// The store's footer shows the ways buyers can pay, unless the theme turns it off.

test("the footer shows how buyers can pay", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pay-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Pay ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Pay/ })).toBeVisible();
  const handle = `pay-${id}`.toLowerCase();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`/s/${handle}`);
  const methods = buyer.getByRole("contentinfo").getByRole("list", { name: "We accept" });
  // A free plan store doesn't take bank transfers.
  await expect(methods.getByRole("listitem")).toHaveText(["Visa", "Mastercard", "American Express", "Apple Pay", "Google Pay"]);

  await page.goto("/admin/theme");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Show how buyers can pay in the footer").uncheck();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("contentinfo").getByRole("link", { name: "Contact us" })).toBeVisible();
  await expect(methods).toHaveCount(0);
  await buyer.context().close();
});
