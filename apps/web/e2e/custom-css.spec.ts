import { expect, test } from "@playwright/test";

// Theme code editing: a merchant adds their own CSS. Bad or unsafe CSS is refused with a reason,
// the preview shows it as they type, the store gets it once published, and checkout keeps the standard look.

test("a merchant adds custom CSS to their store, but not to checkout", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`css-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Stylist ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Stylist/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const productLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/theme");
  await page.getByRole("tab", { name: "CSS" }).click();
  const box = page.getByLabel("Custom CSS");
  // Unsafe or broken CSS is refused, with what to fix.
  await box.fill("</style><script>alert(1)</script>");
  await expect(page.getByRole("alert").filter({ hasText: "HTML tags and scripts aren't allowed" })).toBeVisible();
  await box.fill('@import "https://example.com/x.css";');
  await expect(page.getByRole("alert").filter({ hasText: "@import" })).toBeVisible();
  await box.fill(".store h1 { color: red;");
  await expect(page.getByRole("alert").filter({ hasText: "A { is missing its closing }." })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("A { is missing its closing }.").first()).toBeVisible();
  await expect(page.getByText("Everything is live.")).toHaveCount(0);

  // Good CSS shows in the preview straight away, and on the store once published.
  await box.fill('.store .btn-primary { border-radius: 999px; outline: 3px solid rgb(255, 0, 128); }\n.store footer { letter-spacing: 0.05em; content: "\\201C"; }');
  await expect(box).toHaveAttribute("aria-invalid", "false");
  await expect(page.frameLocator('iframe[title="Store preview"]').locator("style[data-custom-css]")).toHaveCount(1);
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(productLink);
  const add = buyer.getByRole("button", { name: "Add to cart" });
  await expect(add).toHaveCSS("outline-color", "rgb(255, 0, 128)");
  await add.click();
  await expect(buyer).toHaveURL(/\/cart$/);
  await expect(buyer.locator("style[data-custom-css]")).toHaveCount(1);
  await buyer.getByRole("link", { name: "Check out" }).or(buyer.getByRole("button", { name: "Check out" })).first().click();
  await expect(buyer.getByLabel("Full name")).toBeVisible();
  const pay = buyer.getByRole("button", { name: "Continue to payment" });
  await expect(pay).toBeVisible();
  await expect(pay).not.toHaveCSS("outline-color", "rgb(255, 0, 128)");
  // Opened directly, checkout doesn't carry the CSS at all.
  await buyer.reload();
  await expect(buyer.getByLabel("Full name")).toBeVisible();
  await expect(buyer.locator("style[data-custom-css]")).toHaveCount(0);
  // Back on the store, the CSS applies again.
  await buyer.goto(productLink);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toHaveCSS("outline-color", "rgb(255, 0, 128)");
});
