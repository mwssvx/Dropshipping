import { expect, test, type Page } from "@playwright/test";

// The shopping assistant: once the merchant turns it on, shoppers can ask it about products from
// any store page, and its answers link to the products it means.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test("shoppers ask the store's assistant about products once the merchant turns it on", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`shopper-ai-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Ask ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Ask/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // Off until the merchant turns it on.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(buyer.getByRole("button", { name: "Ask us" })).toHaveCount(0);

  await page.goto("/admin/ai");
  await expect(page.getByText("Runs on Claude Haiku 5.5").first()).toBeVisible();
  await page.getByLabel("Show the shopping assistant on your store").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await buyer.goto(product.replace(/\/products\/.*$/, "") || "/");
  await buyer.getByRole("button", { name: "Ask us" }).click();
  const chat = buyer.getByRole("dialog", { name: "Shopping assistant" });
  await chat.getByLabel("Ask a question…").fill("Do you have a projection lamp?");
  await chat.getByRole("button", { name: "Send" }).click();
  const link = chat.getByRole("link", { name: /Sunset Projection Lamp/i }).first();
  await expect(link).toBeVisible();
  // The product it means, as a card with its photo and price.
  await expect(chat.getByRole("article", { name: "Sunset Projection Lamp" })).toContainText(/from \$\d+\.\d\d/);
  await shot(buyer, "144-shop-assistant");

  // On the product's page, "it" means that product, and the chat carries over.
  await link.click();
  await expect(buyer.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await buyer.getByRole("button", { name: "Ask us" }).click();
  await expect(chat.getByText("Do you have a projection lamp?")).toBeVisible();
  await chat.getByLabel("Ask a question…").fill("How long does delivery take for it?");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByText(/usually arrives/)).toBeVisible();
});
