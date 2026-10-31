import { expect, test } from "@playwright/test";

// The home page's featured product: one product up close with its price, the merchant's own
// words and Add to cart. A product with options to pick sends the shopper to its page instead.

test("a merchant features one product and a shopper adds it from the home page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`featured-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Featured ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Featured/ })).toBeVisible();
  let store = "";
  // The lamp comes in two sizes; the stand has nothing to pick.
  for (const name of [/sunset projection lamp/i, /magnetic phone stand/i]) {
    await page.goto("/admin/products/import");
    await page.getByRole("link", { name }).click();
    await page.getByRole("button", { name: "Import and publish" }).click();
    await expect(page.getByText("Imported and live on your store.")).toBeVisible();
    store ||= (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!.replace(/\/products\/.*$/, "");
  }

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("featured_product");
  await page.getByLabel("Product", { exact: true }).selectOption({ label: "Sunset Projection Lamp" });
  const lamp = preview.getByRole("region", { name: "Sunset Projection Lamp" });
  await lamp.scrollIntoViewIfNeeded();
  await expect(lamp.getByRole("heading", { name: "Sunset Projection Lamp" })).toBeVisible();
  await expect(lamp.getByRole("link", { name: "Choose options" })).toBeVisible();

  await page.getByLabel("Product", { exact: true }).selectOption({ label: "Magnetic Phone Stand" });
  await page.getByLabel("A few words about it (optional)").fill("Holds your phone at eye level on any desk.");
  const stand = preview.getByRole("region", { name: "Magnetic Phone Stand" });
  await expect(stand.getByText("Holds your phone at eye level on any desk.")).toBeVisible();
  await expect(stand.getByRole("button", { name: "Add to cart" })).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`${store}/`);
  const live = buyer.getByRole("region", { name: "Magnetic Phone Stand" });
  await live.scrollIntoViewIfNeeded();
  await expect(live.getByText("Holds your phone at eye level on any desk.")).toBeVisible();
  await expect(live.getByRole("link", { name: "See full details" })).toHaveAttribute("href", /\/products\//);
  await live.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer).toHaveURL(/\/cart/);
  await expect(buyer.getByRole("link", { name: /Magnetic Phone Stand/ }).first()).toBeVisible();
  await buyer.context().close();
});
