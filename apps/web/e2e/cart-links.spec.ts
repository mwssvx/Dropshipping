import { expect, test, type Page } from "@playwright/test";

// Cart links: one link that fills a shopper's cart with chosen products and a code.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a merchant makes a cart link and a shopper lands on a full cart", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cl-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Links ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Links/ })).toBeVisible();
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  }
  await page.goto("/admin/marketing");
  await page.getByLabel("Code", { exact: true }).fill("dm10");
  await page.getByLabel("Percent").fill("10");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText("Code created. Buyers can use it now.")).toBeVisible();
  await page.getByRole("link", { name: "Open cart links" }).click();

  const form = page.getByRole("region", { name: "New cart link" });
  await form.getByLabel("Link name").fill("Instagram DM");
  const lamp = form.getByLabel("Product 1");
  await lamp.selectOption({ label: (await lamp.locator("option", { hasText: /Sunset Projection Lamp/ }).first().textContent())!.trim() });
  await form.getByLabel("How many").first().fill("2");
  await form.getByRole("button", { name: "Add a product" }).click();
  const stand = form.getByLabel("Product 2");
  await stand.selectOption({ label: (await stand.locator("option", { hasText: /Magnetic Phone Stand/ }).first().textContent())!.trim() });
  await form.getByLabel("Code in the cart (optional)").selectOption("DM10");
  await form.getByRole("button", { name: "Make the link" }).click();
  await expect(form.getByText("Link made.", { exact: false })).toBeVisible();

  // A second link can't share the name, and what was typed stays after the error.
  await form.getByLabel("Link name").fill("instagram dm");
  await form.getByLabel("Product 1").selectOption({ index: 1 });
  await form.getByRole("button", { name: "Make the link" }).click();
  await expect(form.locator(".banner-critical")).toContainText('You already have a link called "instagram dm"');
  await expect(form.getByLabel("Link name")).toHaveValue("instagram dm");

  const card = page.getByRole("listitem", { name: "Instagram DM" });
  await expect(card.getByText("0 clicks · 0 orders")).toBeVisible();
  await expect(card.getByText(/^2 × Sunset Projection Lamp/)).toBeVisible();
  const url = await card.getByLabel("Link for Instagram DM").inputValue();
  await shot(page, "473-cart-links");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(url);
  await expect(buyer).toHaveURL(/\/cart\?utm_source=link-instagram-dm/);
  await expect(buyer.getByRole("link", { name: /^Cart, 3 items/ })).toBeVisible();
  await expect(buyer.getByText("DM10").first()).toBeVisible();

  await page.reload();
  await expect(card.getByText(/^1 click · 0 orders/)).toBeVisible();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
  await page.goto("/admin/activity");
  await expect(page.getByText("Made the cart link “Instagram DM”")).toBeVisible();
});
