import { expect, test, type Page } from "@playwright/test";

// Web addresses: a renamed product keeps its old links working, and merchants paste old links
// from a previous store so they land on the right page.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("renaming a product and pasting old links keep buyers' links working", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rd-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Links ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Links/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const oldLink = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const store = oldLink.replace(/\/products\/.*$/, "");

  const address = page.getByRole("form", { name: "Web address" });
  await address.getByLabel("Address").fill("Glow Lamp");
  await address.getByRole("button", { name: "Save address" }).click();
  await expect(address.getByRole("status")).toContainText("Links to the old address still work");
  await expect(address.getByLabel("Address")).toHaveValue("glow-lamp");
  await expect(page.getByRole("link", { name: "View on store ↗" })).toHaveAttribute("href", `${store}/products/glow-lamp`);

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(oldLink);
  await expect(buyer).toHaveURL(new RegExp(`${store}/products/glow-lamp$`));
  await expect(buyer.getByRole("heading", { name: "Sunset Projection Lamp" })).toBeVisible();

  // Old links from a previous store.
  await page.goto("/admin/redirects");
  await expect(page.getByRole("cell", { name: oldLink.replace(store, ""), exact: true })).toBeVisible();
  await page.getByLabel(/One per line/).fill("https://old-store.example.com/pages/About-Us/, /products/glow-lamp\n/cart /");
  await page.getByRole("button", { name: "Add redirects" }).click();
  await expect(page.getByText("Added 1 redirect.")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "wasn't added" })).toContainText("/cart /");
  await expect(page.getByLabel(/One per line/)).toHaveValue("/cart /");
  await shot(page, "124-redirects");

  await buyer.goto(`${store}/pages/about-us`);
  await expect(buyer).toHaveURL(new RegExp(`${store}/products/glow-lamp$`));
  await buyer.goto(`${store}/some/old/link`);
  await expect(buyer.getByText("We couldn't find that page")).toBeVisible();

  await page.reload();
  const row = page.getByRole("row").filter({ hasText: "/pages/about-us" });
  await expect(row.getByRole("cell").nth(2)).toHaveText("1");
  await page.getByRole("button", { name: "Remove redirect from /pages/about-us" }).click();
  await expect(page.getByRole("row").filter({ hasText: "/pages/about-us" })).toHaveCount(0);
});
