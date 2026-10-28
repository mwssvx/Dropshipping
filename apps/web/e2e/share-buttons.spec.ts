import { expect, test } from "@playwright/test";

// Share buttons on product pages: copy the link, or share it on WhatsApp, Facebook and Pinterest
// with the product's photo. The merchant can turn them off.

test("shoppers share a product, until the merchant turns it off", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`sb-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Shared ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Shared/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  const context = await browser.newContext({ ...info.project.use });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const buyer = await context.newPage();
  await buyer.goto(`${product}?ref=newsletter`);
  const share = buyer.getByRole("group", { name: "Share" });
  const pageUrl = new URL(product, buyer.url()).href;
  // The shared link is the page's own address, without the query.
  await expect(share.getByRole("link", { name: "Share on WhatsApp" })).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\?text=.*${encodeURIComponent(pageUrl).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect(share.getByRole("link", { name: "Share on Facebook" })).toHaveAttribute("href", `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`);
  const pin = (await share.getByRole("link", { name: "Share on Pinterest" }).getAttribute("href"))!;
  expect(pin.startsWith(`https://www.pinterest.com/pin/create/button/?url=${encodeURIComponent(pageUrl)}&description=Sunset%20Projection%20Lamp`)).toBe(true);
  await share.getByRole("button", { name: "Copy link" }).click();
  await expect(share.getByRole("status")).toHaveText("Link copied");
  expect(await buyer.evaluate(() => navigator.clipboard.readText())).toBe(pageUrl);

  await page.goto("/admin/products");
  await page.getByLabel("Show share buttons on product pages").uncheck();
  await page.getByRole("button", { name: "Save share setting" }).click();
  await expect(page.getByText("Saved. Your product pages follow it now.")).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByRole("heading", { name: /Sunset Projection Lamp/ })).toBeVisible();
  await expect(buyer.getByRole("group", { name: "Share" })).toHaveCount(0);
  await context.close();
});
