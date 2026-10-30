import { expect, test, type Page } from "@playwright/test";

// Breadcrumbs on product pages: Home › a collection › the product, with the same trail for
// search engines. The collection is the one the shopper came from when the product is in it.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png` });
};

test("product pages show where the product sits in the store", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`crumbs-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Crumbs ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Crumbs/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const store = product.replace(/\/products\/.*$/, "");

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(product);
  const trail = buyer.getByRole("navigation", { name: "Breadcrumb" });
  // Each step after the first starts with a › that screen readers skip.
  const steps = (...names: string[]) => expect(trail.getByRole("listitem")).toHaveText(names.map((n, i) => (i ? new RegExp(`^›\\s*${n}$`) : n)));
  await steps("Home", "Sunset Projection Lamp");
  await expect(trail.getByText("Sunset Projection Lamp")).toHaveAttribute("aria-current", "page");

  // In two collections, the trail goes through the first, unless the shopper came from the other.
  for (const title of ["Night lights", "Gifts"]) {
    await page.goto("/admin/collections/new");
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: /Sunset Projection Lamp/ }).click();
    await page.getByRole("button", { name: "Save collection" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }
  await buyer.reload();
  await steps("Home", "Night lights", "Sunset Projection Lamp");
  await shot(buyer, "breadcrumbs");

  await buyer.goto(`${store}/collections/gifts`);
  await buyer.getByRole("link", { name: /Sunset Projection Lamp/ }).first().click();
  await steps("Home", "Gifts", "Sunset Projection Lamp");
  await trail.getByRole("link", { name: "Gifts" }).click();
  await expect(buyer).toHaveURL(new RegExp(`${store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/collections/gifts$`));
  await buyer.goBack();
  await trail.getByRole("link", { name: "Home" }).click();
  await expect(buyer).toHaveURL(new RegExp(`${store.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`));

  // Search engines get the same trail, with full addresses.
  await buyer.goto(product);
  const data = await buyer.locator('script[type="application/ld+json"]').allTextContents();
  const list = data.map((d) => JSON.parse(d)).find((d) => d["@type"] === "BreadcrumbList");
  expect(list.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Home", "Night lights", "Sunset Projection Lamp"]);
  expect(list.itemListElement[2].item).toBe(new URL(product, buyer.url()).href);
});
