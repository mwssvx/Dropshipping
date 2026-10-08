import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Milestone 7 (part 2): analytics, a public API with keys, signed webhooks, and taking the store
// to a new one with an export file. Set SCREENSHOTS_DIR to also save the screens for review.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchant(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`m7b-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lumen ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lumen/ })).toBeVisible();
}

async function importLamp(page: Page) {
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return { admin: page.url().split("?")[0]!, store: (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))! };
}

async function buy(page: Page, productUrl: string) {
  await page.goto(productUrl);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Check out" }).click();
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Full name").fill("Ada Buyer");
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or region").fill("TX");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
}

test("analytics shows sales, the visit-to-sale funnel and best sellers", async ({ page, browser }, info) => {
  await newMerchant(page, `${info.project.name}-${Date.now()}`);
  const lamp = await importLamp(page);
  await page.getByRole("link", { name: "Analytics" }).first().click();
  await expect(page.getByText("No sales in the last 30 days yet.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp.store.replace(/\/products\/.*/, ""));
  await buy(buyer, lamp.store);

  await expect(async () => {
    await page.reload();
    const funnel = page.getByRole("region", { name: "From visit to sale" });
    await expect(funnel.getByRole("listitem").filter({ hasText: "Visited the store" })).toContainText("1", { timeout: 1000 });
    await expect(funnel.getByRole("listitem").filter({ hasText: "Started checkout" })).toContainText("1", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  const funnel = page.getByRole("region", { name: "From visit to sale" });
  await expect(funnel.getByRole("listitem").filter({ hasText: "Looked at a product" })).toContainText("1");
  await expect(funnel.getByRole("listitem").filter({ hasText: "Added to cart" })).toContainText("1");
  await expect(funnel.getByRole("listitem").filter({ hasText: "Paid" })).toContainText("1");
  await expect(page.getByRole("img", { name: /Sales for each of the last 30 days/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Best sellers" }).getByRole("row", { name: /Sunset Projection Lamp/ })).toContainText("1");
  await expect(page.getByText("Conversion").locator("..")).toContainText("100%");
  await shot(page, "72-analytics");
});

test("API keys and signed webhooks", async ({ page, browser, request }, info) => {
  const got: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ headers: req.headers, body });
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

  try {
    await newMerchant(page, `${info.project.name}-${Date.now()}`);
    const lamp = await importLamp(page);
    const productId = lamp.admin.split("/").at(-1)!;

    // A read-only key reads but can't change anything.
    await page.getByRole("link", { name: "Developers" }).first().click();
    await page.getByLabel("Key name").fill("Reporting");
    await page.getByRole("button", { name: "Create key" }).click();
    const readKey = (await page.getByLabel("New API key").textContent())!;
    expect(readKey).toMatch(/^sfk_/);
    const auth = (key: string) => ({ authorization: `Bearer ${key}` });
    const products = await request.get("/api/v1/products", { headers: auth(readKey) });
    expect(products.status()).toBe(200);
    expect((await products.json()).products[0]).toMatchObject({ id: productId, title: "Sunset Projection Lamp", status: "active" });
    const denied = await request.patch(`/api/v1/products/${productId}`, { headers: auth(readKey), data: { status: "draft" } });
    expect(denied.status()).toBe(403);
    expect((await request.get("/api/v1/orders", { headers: auth("sfk_wrongwrongwrongwrongwrong") })).status()).toBe(401);

    // A write key changes a price.
    await page.getByLabel("Key name").fill("Inventory sync");
    await page.getByLabel("Access").selectOption("write");
    await page.getByRole("button", { name: "Create key" }).click();
    await expect(page.getByText("Copy the key for Inventory sync now.")).toBeVisible();
    const writeKey = (await page.getByLabel("New API key").textContent())!;
    const variantId = (await products.json()).products[0].variants[0].id;
    const patched = await request.patch(`/api/v1/products/${productId}`, { headers: auth(writeKey), data: { variants: [{ id: variantId, price: 4200 }] } });
    expect(patched.status()).toBe(200);
    expect((await patched.json()).product.variants[0].price).toBe(4200);

    // A webhook: the test ping arrives, then a real order.
    await page.getByLabel("Address").fill(hookUrl);
    await page.getByRole("button", { name: "Add webhook" }).click();
    const card = page.getByRole("article", { name: `Webhook ${hookUrl}` });
    await card.getByRole("button", { name: "Send test" }).click();
    await expect(card.getByText("Delivered. Your server answered 200.")).toBeVisible();
    expect(JSON.parse(got[0]!.body).event).toBe("ping");
    await card.getByRole("button", { name: "Show" }).click();
    const secret = (await card.getByText(/^whsec_/).textContent())!;
    await shot(page, "73-developers");

    const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
    await buy(buyer, lamp.store);
    await expect.poll(() => got.find((g) => g.headers["x-storefront-event"] === "order.paid"), { timeout: 15_000 }).toBeTruthy();
    const paid = got.find((g) => g.headers["x-storefront-event"] === "order.paid")!;
    const json = JSON.parse(paid.body);
    expect(json.data.order).toMatchObject({ number: 1001, total: expect.any(Number), payment_status: "paid", email: "ada@example.com" });
    expect(json.data.order.lines[0]).toMatchObject({ title: expect.stringMatching(/^Sunset Projection Lamp/), unit_price: 4200 });
    const [t, v1] = String(paid.headers["x-storefront-signature"]).split(",").map((p) => p.split("=")[1]);
    expect(createHmac("sha256", secret).update(`${t}.${paid.body}`).digest("hex")).toBe(v1);

    await page.reload();
    await expect(page.getByRole("article", { name: `Webhook ${hookUrl}` }).getByRole("row", { name: /order\.paid/ })).toContainText("Delivered");
    const orders = await request.get("/api/v1/orders?payment_status=paid", { headers: auth(readKey) });
    expect((await orders.json()).orders).toHaveLength(1);
    await shot(page, "74-developers-deliveries");

    // Revoked keys stop working.
    await page.getByRole("button", { name: "Revoke Reporting" }).click();
    await expect(page.getByRole("button", { name: "Revoke Reporting" })).toHaveCount(0);
    expect((await request.get("/api/v1/orders", { headers: auth(readKey) })).status()).toBe(401);
  } finally {
    server.close();
  }
});

test("a store file moves products, pages and theme into a new store", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  await importLamp(page);
  await page.goto("/admin/pages");
  await page.getByRole("link", { name: /New page|Add page/ }).first().click();
  await page.getByLabel("Title").fill("About us");
  await page.getByLabel("Text", { exact: true }).fill("We make warm lights for small rooms.");
  await page.getByRole("button", { name: "Save page" }).click();
  await expect(page.getByText("About us").first()).toBeVisible();

  await page.getByRole("link", { name: "Export and import" }).first().click();
  await expect(page.getByText("Store files load into a new, empty store")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download store file" }).click()]);
  const file = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(file).toMatchObject({ format: "storefront-store", version: 1 });
  expect(file.products[0].title).toBe("Sunset Projection Lamp");
  await shot(page, "75-export");

  await page.getByRole("link", { name: "Create a new store" }).click();
  await page.getByLabel("Store name").fill(`Lumen Two ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lumen Two/ })).toBeVisible();
  await page.goto("/admin/export");
  await page.getByLabel("Store file (.json)").setInputFiles({ name: "store.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await page.getByRole("button", { name: "Load store file" }).click();
  await expect(page.getByText(/Loaded 1 product, 0 collections, 1 page and your theme\./)).toBeVisible();
  await shot(page, "76-import-done");
  await page.goto("/admin/products");
  await expect(page.getByText("Sunset Projection Lamp")).toBeVisible();
});
