import { expect, test } from "@playwright/test";

// The theme editor warns when a color choice makes text, buttons or links hard to read.

test("the theme editor warns about links that are hard to read", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`contrast-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Contrast ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Contrast/ })).toBeVisible();

  await page.goto("/admin/theme");
  await page.getByRole("tab", { name: "Style" }).click();
  await expect(page.getByText(/hard to read/)).toHaveCount(0);
  // Yellow buttons with dark text are fine, but yellow links on white aren't.
  await page.getByLabel("Buttons and links", { exact: true }).fill("#facc15");
  await page.getByLabel("Button text", { exact: true }).fill("#111111");
  await expect(page.getByText(/Links are hard to read on this background \(1\.\d:1\)/)).toBeVisible();
  await expect(page.getByText(/Button text is hard to read/)).toHaveCount(0);
  await page.getByLabel("Background", { exact: true }).fill("#111111");
  await page.getByLabel("Text", { exact: true }).fill("#f4f4f5");
  await expect(page.getByText(/hard to read/)).toHaveCount(0);
});
