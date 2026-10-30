import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The pages every shopper goes through, checked against WCAG 2.1 AA (what the European
// Accessibility Act asks of online stores). Any rule broken on any of them fails the test.

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`);
}

test("the store's shopping pages pass an accessibility check", async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`a11y-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Access ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Access/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const store = product.replace(/\/products\/.*$/, "");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const found: string[] = [];
  for (const path of ["/", "/collections/all", "/search?q=lamp", product.slice(store.length), "/cart", "/checkout", "/contact", "/track", "/account", "/gift-cards", "/blog"]) {
    await buyer.goto(`${store}${path}`);
    for (const v of await violations(buyer)) found.push(`${path} ${v}`);
    // Fill the cart so the cart and checkout pages show their full forms.
    if (path.startsWith("/products/")) {
      await buyer.getByRole("button", { name: "Add to cart" }).first().click();
      await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
    }
  }

  // Each ready-made theme has its own colors and layout, so check its home and product pages too.
  for (const name of ["Bold", "Warm", "Boutique", "Market", "Studio", "Nordic"]) {
    await page.goto("/admin/theme");
    await page.getByRole("tab", { name: "Themes" }).click();
    await page.getByLabel("Also replace my home page sections").check();
    await page.getByRole("button", { name: `Use ${name}` }).click();
    await expect(page.getByRole("status").filter({ hasText: `${name} applied` })).toBeVisible();
    await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Everything is live.")).toBeVisible();
    for (const path of ["/", product.slice(store.length)]) {
      await buyer.goto(`${store}${path}`);
      for (const v of await violations(buyer)) found.push(`${name} ${path} ${v}`);
    }
  }
  expect(found).toEqual([]);
  await buyer.context().close();
});

test("the main admin pages pass an accessibility check", async ({ page }, info) => {
  test.setTimeout(120_000);
  const id = `${info.project.name}-${Date.now()}`;
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    expect(await violations(page)).toEqual([]);
  }
  await page.getByLabel("Email").fill(`a11y-admin-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Access admin ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Access admin/ })).toBeVisible();
  const found: string[] = [];
  for (const path of ["/admin", "/admin/orders", "/admin/products", "/admin/products/import", "/admin/customers", "/admin/money", "/admin/analytics", "/admin/sales", "/admin/marketing", "/admin/settings", "/admin/theme"]) {
    await page.goto(path);
    for (const v of await violations(page)) found.push(`${path} ${v}`);
  }
  expect(found).toEqual([]);
});
