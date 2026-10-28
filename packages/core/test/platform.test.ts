import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  analyticsReport,
  authenticateApiKey,
  createApiKey,
  createCollection,
  createDiscount,
  createShop,
  createWebhookEndpoint,
  deliverDueWebhooks,
  DemoModel,
  exportStore,
  getTheme,
  importStore,
  isPrivateHost,
  listApiKeys,
  productsCsv,
  publicOrder,
  queueShopWebhooks,
  recordEvent,
  refundOrder,
  revokeApiKey,
  runWebhooks,
  sendTestWebhook,
  setUpsell,
  signUp,
  sourceOf,
  verifyWebhookSignature,
  WEBHOOK_BACKOFF,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const SESSION = (n: number) => `visitor-session-${n}`;

describe("analytics", () => {
  it("adds up sales by day, the funnel, best sellers and sources", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    for (let i = 1; i <= 4; i++) await recordEvent(f.db, shop.id, { sessionId: SESSION(i), kind: "page_view", referrer: i <= 2 ? "https://www.instagram.com/p/1" : null, host: "glow.example" });
    for (let i = 1; i <= 3; i++) await recordEvent(f.db, shop.id, { sessionId: SESSION(i), kind: "product_view", productId: f.products.lamp.id });
    await recordEvent(f.db, shop.id, { sessionId: SESSION(1), kind: "add_to_cart", productId: f.products.lamp.id });
    await recordEvent(f.db, shop.id, { sessionId: SESSION(1), kind: "checkout_start" });
    // Junk is dropped: bad session ids, unknown kinds, other stores' products.
    expect(await recordEvent(f.db, shop.id, { sessionId: "x", kind: "page_view" })).toBe(false);
    expect(await recordEvent(f.db, shop.id, { sessionId: SESSION(9), kind: "purchase" })).toBe(false);
    expect(await recordEvent(f.db, shop.id, { sessionId: SESSION(9), kind: "product_view", productId: "00000000-0000-0000-0000-000000000000" })).toBe(false);

    const a = await f.waitingOrder();
    const b = await f.waitingOrder();
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const r = await analyticsReport(f.db, shop.id, { from: new Date(today - 6 * DAY), to: new Date(today + DAY) });
    expect(r.days).toHaveLength(7);
    expect(r.days.at(-1)).toMatchObject({ date: now.toISOString().slice(0, 10), orders: 2, visitors: 4 });
    expect(r).toMatchObject({ orders: 2, salesMinor: a.totalMinor + b.totalMinor, visitors: 4, conversion: 0.5 });
    expect(r.funnel.map((s) => s.count)).toEqual([4, 3, 1, 1, 2]);
    expect(r.topProducts[0]).toMatchObject({ productId: f.products.lamp.id, title: "Sunset Projection Lamp", units: 2, views: 3 });
    expect(r.sources).toEqual(expect.arrayContaining([{ source: "instagram.com", visitors: 2 }, { source: "Direct", visitors: 2 }]));
  });

  it("knows a link inside the store isn't a source", () => {
    expect(sourceOf("https://glow.example/products/x", "glow.example:443")).toBeNull();
    expect(sourceOf("https://l.facebook.com/l.php?u=x", "glow.example")).toBe("facebook.com");
    expect(sourceOf("not a url", "glow.example")).toBeNull();
  });
});

describe("API keys", () => {
  it("shows a key once, finds the store from it, and stops working when revoked", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { key, row } = await createApiKey(f.db, shop.id, { name: "Inventory sync", access: "read" });
    expect(key).toMatch(/^sfk_/);
    expect(JSON.stringify(await listApiKeys(f.db, shop.id))).not.toContain(key);
    expect((await authenticateApiKey(f.db, key))?.shop.id).toBe(shop.id);
    expect(await authenticateApiKey(f.db, `${key}x`)).toBeNull();
    await revokeApiKey(f.db, shop.id, row.id);
    expect(await authenticateApiKey(f.db, key)).toBeNull();
  });

  it("shows orders in a stable public shape", async () => {
    const f = await makeFixture(new DemoModel());
    const o = await f.shippedOrder();
    const lines = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, o.id) });
    const fulfillments = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, o.id) });
    const p = publicOrder({ ...o, lines, fulfillments });
    expect(p).toMatchObject({ id: o.id, number: o.number, total: o.totalMinor, payment_status: "paid", fulfillment_status: "shipped" });
    expect(p.shipments?.[0]).toMatchObject({ carrier: "Demo Post", status: "shipped" });
    expect(Object.keys(p)).not.toContain("paymentIntentId");
  });
});

/** A local receiver that answers with the given statuses in turn and keeps what it got. */
async function receiver(statuses: number[]) {
  const got: { headers: Record<string, string>; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ headers: req.headers as Record<string, string>, body });
      res.statusCode = statuses[Math.min(got.length - 1, statuses.length - 1)]!;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`;
  return { url, got, close: () => new Promise((r) => server.close(r)) };
}

describe("webhooks", () => {
  it("refuses private and plain-http addresses outside development", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await expect(createWebhookEndpoint(f.db, shop.id, { url: "http://example.com/x", events: ["order.paid"] })).rejects.toThrow("https://");
    await expect(createWebhookEndpoint(f.db, shop.id, { url: "https://192.168.1.4/x", events: ["order.paid"] })).rejects.toThrow("private network");
    await expect(createWebhookEndpoint(f.db, shop.id, { url: "https://example.com/x", events: ["nope"] })).rejects.toThrow("at least one event");
    expect(["10.0.0.1", "127.0.0.1", "169.254.169.254", "::1", "fd00::1", "localhost", "metadata.internal"].every(isPrivateHost)).toBe(true);
    expect(["93.184.216.34", "example.com", "2606:4700::1111"].some(isPrivateHost)).toBe(false);
  });

  it("sends signed events once each, and retries with growing gaps", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const r = await receiver([500, 200]);
    try {
      const ep = await createWebhookEndpoint(f.db, shop.id, { url: r.url, events: ["order.paid", "order.shipped", "order.refunded"] }, { allowPrivate: true });
      const ctx = { db: f.db, allowPrivate: true };
      const order = await f.shippedOrder();
      // The fixture's supplier ships a day ahead of the real clock.
      const now = new Date(Date.now() + DAY + 60_000);
      expect(await queueShopWebhooks(f.db, shop.id, now)).toBe(2);
      expect(await queueShopWebhooks(f.db, shop.id, now)).toBe(0);

      // First try: the receiver fails the first one, so it waits a minute.
      const first = await deliverDueWebhooks(ctx, now);
      expect(first).toMatchObject({ tried: 2, delivered: 1 });
      const retry = (await f.db.query.webhookDeliveries.findMany()).find((d) => d.status === "pending")!;
      expect(retry).toMatchObject({ attempts: 1, lastStatusCode: 500 });
      expect(retry.nextAttemptAt.getTime()).toBe(now.getTime() + WEBHOOK_BACKOFF[0]!);
      expect((await deliverDueWebhooks(ctx, now)).tried).toBe(0);
      expect((await deliverDueWebhooks(ctx, new Date(now.getTime() + WEBHOOK_BACKOFF[0]!))).delivered).toBe(1);

      const paid = r.got.map((g) => ({ ...g, json: JSON.parse(g.body) })).find((g) => g.json.event === "order.paid")!;
      expect(paid.json.data.order).toMatchObject({ id: order.id, number: order.number });
      expect(paid.headers["x-storefront-event"]).toBe("order.paid");
      expect(verifyWebhookSignature(ep.secret, paid.headers["x-storefront-signature"]!, paid.body, now)).toBe(true);
      expect(verifyWebhookSignature(ep.secret, paid.headers["x-storefront-signature"]!, paid.body.replace("paid", "PAID"), now)).toBe(false);
      expect(verifyWebhookSignature(ep.secret, paid.headers["x-storefront-signature"]!, paid.body, new Date(now.getTime() + 10 * 60_000))).toBe(false);

      // A refund later is a new event.
      await refundOrder({ ...f.ctx, payments: f.payments }, shop.id, order.id, { amountMinor: 500, reason: "Scratched" });
      const later = await runWebhooks(ctx, new Date(now.getTime() + 10 * 60_000));
      expect(later).toMatchObject({ queued: 1, delivered: 1 });
      expect(JSON.parse(r.got.at(-1)!.body).data.refund).toMatchObject({ amount: 500, reason: "Scratched" });
      expect((await sendTestWebhook(ctx, shop.id, ep.id)).ok).toBe(true);
    } finally {
      await r.close();
    }
  });

  it("gives up after the sixth try", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const r = await receiver([503]);
    try {
      await createWebhookEndpoint(f.db, shop.id, { url: r.url, events: ["order.paid"] }, { allowPrivate: true });
      await f.waitingOrder();
      let t = Date.now() + 1000;
      await queueShopWebhooks(f.db, shop.id, new Date(t));
      for (let i = 0; i < 6; i++) {
        await deliverDueWebhooks({ db: f.db, allowPrivate: true }, new Date(t));
        t += WEBHOOK_BACKOFF[i] ?? 0;
      }
      expect(await f.db.query.webhookDeliveries.findFirst()).toMatchObject({ status: "failed", attempts: 6, lastStatusCode: 503 });
      expect(r.got).toHaveLength(6);
    } finally {
      await r.close();
    }
  });

  it("won't reach a private address even when the name looked public", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const ep = await createWebhookEndpoint(f.db, shop.id, { url: "https://localtest.me/hook", events: ["order.paid"] });
    const res = await sendTestWebhook({ db: f.db, fetch: (async () => new Response("ok")) as typeof fetch }, shop.id, ep.id);
    expect(res).toMatchObject({ ok: false, error: "The address points to a private network." });
  });
});

describe("store export", () => {
  it("loads a store file into a new store, and refuses one that isn't empty", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await f.returnsPage();
    const col = await createCollection(f.db, shop.id, { title: "Night lights", description: "Glow", productIds: [f.products.lamp.id, f.products.projector.id] });
    await setUpsell(f.db, shop.id, f.products.lamp.id, f.products.projector.id);
    await createDiscount(f.db, shop.id, { code: "WELCOME10", kind: "percent", value: 10 });
    const theme = await getTheme(f.db, shop);
    const featured = { id: "feat01", type: "featured_products", hidden: false, settings: { heading: "Night lights", collectionId: col.id, limit: 4 } };
    await f.db.update(schema.themes).set({ published: { ...theme.published, home: [...theme.published.home, featured] } }).where(eq(schema.themes.shopId, shop.id));
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.products).toHaveLength(3);

    const user = await signUp(f.db, { email: "new@example.com", password: "correct horse" });
    const fresh = await createShop(f.db, user.id, { name: "Glow Again", country: "US" });
    await expect(importStore(f.db, fresh.id, { ...file, format: "other" })).rejects.toThrow("isn't a store file from us");
    const result = await importStore(f.db, fresh.id, file);
    expect(result).toMatchObject({ products: 3, collections: 1, pages: 1, discountCodes: 1, theme: true });
    await expect(importStore(f.db, fresh.id, file)).rejects.toThrow("new, empty store");

    const again = await exportStore(f.db, fresh.id);
    const byHandle = (a: { handle: string }, b: { handle: string }) => a.handle.localeCompare(b.handle);
    const strip = (x: typeof file) => ({
      ...x,
      exported_at: null,
      products: [...x.products].sort(byHandle),
      collections: x.collections.map((c: { id?: string; products: string[] }) => ({ ...c, id: null, products: [...c.products].sort() })),
      theme: null,
      store: { ...x.store, name: null },
    });
    expect(strip(JSON.parse(JSON.stringify(again)))).toEqual(strip(file));
    // The home section points at the new collection.
    const newCol = again.collections[0]!;
    expect(JSON.stringify(again.theme!.published)).toContain(newCol.id);
    expect(newCol.id).not.toBe(col.id);
    // Imported products still go to the supplier.
    const lamp = (await f.db.query.products.findFirst({ where: eq(schema.products.shopId, fresh.id) }))!;
    expect(lamp.supplierId).not.toBeNull();
  });

  it("writes products as CSV, one row per variant", async () => {
    const f = await makeFixture(new DemoModel());
    const csv = await productsCsv(f.db, (await f.shop()).id);
    const rows = csv.trim().split("\n");
    expect(rows[0]).toBe("Handle,Title,Status,Variant,SKU,Price,Compare at price,Cost,Stock,Image URL,Supplier link,Tags");
    expect(rows.some((r) => r.startsWith("sunset-projection-lamp,Sunset Projection Lamp,active,"))).toBe(true);
  });
});
