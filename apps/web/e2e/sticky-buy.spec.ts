import { expect, test } from "@playwright/test";

// On phones, a bar keeps Add to cart in reach once the buyer scrolls past the button.

test("the buy bar shows on phones after scrolling past Add to cart, and adds the product", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sticky-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Sunset Lamp");
  await page.getByLabel("Description").fill(Array.from({ length: 40 }, (_, n) => `Line ${n + 1}: warm, dimmable light that turns any room golden.`).join("\n"));
  await page.getByLabel("Price", { exact: true }).fill("29.00");
  await page.getByLabel("Stock", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  const bar = buyer.locator("[data-sticky-buy]");
  // Not while the real button is on screen.
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(bar).toBeHidden();
  await buyer.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  if (info.project.name === "desktop") {
    // Wide screens have room for the button next to the photos; no bar there.
    await expect(bar).toBeHidden();
    return;
  }
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Sunset Lamp");
  await bar.getByText("Add to cart").click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
});
