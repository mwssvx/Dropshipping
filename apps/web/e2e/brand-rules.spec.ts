import { expect, test, type Page } from "@playwright/test";

// Writing rules: the merchant sets a voice and banned words once; every AI draft is checked against
// them before it's saved, and a refused draft shows in the activity log.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test("the AI keeps to the store's writing rules", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`brand-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Brand ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Brand/ })).toBeVisible();

  await page.goto("/admin/ai");
  await page.getByLabel("How your store sounds").fill("Warm and calm, short sentences");
  await page.getByLabel("Words never to use").fill("lamp, cheap");
  await page.getByLabel("Longest product title").fill("40");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Words never to use")).toHaveValue("lamp, cheap");
  await page.getByLabel("Words never to use").scrollIntoViewIfNeeded();
  await shot(page, "148-writing-rules");

  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  await page.getByRole("button", { name: "Write with AI" }).click();
  await expect(page.getByText(/waiting for your OK/)).toBeVisible();

  // The first draft used a banned word and was refused; the rewrite waits for approval without it.
  await page.goto("/admin/assistant");
  const card = page.getByRole("article", { name: /New title and description/ });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText(/lamp/i);
  await page.goto("/admin/ai");
  await expect(page.getByText(/Broke the store's writing rules/).first()).toBeVisible();
});
