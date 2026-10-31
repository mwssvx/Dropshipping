import { expect, test } from "@playwright/test";

// Product cards show a product's stars and review count once it has published reviews, on the
// collection and search pages alike. The theme can turn them off.

test("product cards show their stars until the merchant turns them off", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`cr-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Starred ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Starred/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;
  const store = product.replace(/\/products\/.*$/, "");

  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,,Ada L.,ada@example.com,,"Warm light, perfect for the bedroom.",,2025-03-04 10:00:00 UTC,`,
    `${handle},published,4,,Bob K.,bob@example.com,,Nice colours.,,2025-03-05 10:00:00 UTC,`,
  ].join("\n");
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("2 reviews added");

  const buyerContext = await browser.newContext({ ...info.project.use });
  const buyer = await buyerContext.newPage();
  await buyer.goto(`${store}/collections/all`);
  const card = buyer.getByRole("listitem").filter({ has: buyer.getByText("Sunset Projection Lamp", { exact: true }) });
  await expect(card.getByRole("img", { name: "4.5 out of 5 stars" })).toBeVisible();
  await expect(card.getByText("(2)")).toBeVisible();
  await buyer.goto(`${store}/search?q=lamp`);
  await expect(card.getByRole("img", { name: "4.5 out of 5 stars" })).toBeVisible();

  await page.goto("/admin/theme");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByLabel("Show star ratings on product cards").uncheck();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await buyer.goto(`${store}/collections/all`);
  await expect(card.getByText("Sunset Projection Lamp", { exact: true })).toBeVisible();
  await expect(card.getByRole("img", { name: "4.5 out of 5 stars" })).toBeHidden();
  await buyerContext.close();
});
