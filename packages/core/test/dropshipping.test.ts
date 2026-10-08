import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema, type Db } from "@sf/db";
import {
  addManualTracking,
  CjSupplier,
  createShop,
  DEMO_SUPPLIER_LINKS,
  FakePaymentProvider,
  FakeSupplier,
  getOrder,
  handlePaymentEvent,
  htmlToText,
  importProduct,
  LogMailer,
  onOrderPaid,
  previewImport,
  retryOrder,
  routeOrder,
  routeStuckOrders,
  signUp,
  startCheckout,
  suggestPrice,
  SupplierError,
  suppliersFrom,
  syncTracking,
  UserError,
  type FulfillmentContext,
  type SupplierAdapter,
} from "../src";

const address = { name: "Ada Buyer", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const [LAMP, STAND, SOLD_OUT] = DEMO_SUPPLIER_LINKS as [string, string, string];
const DAY = 86_400_000;

let db: Db;
let clock: number;
let mailer: LogMailer;
let ctx: FulfillmentContext;

function makeCtx(extra: SupplierAdapter[] = []): FulfillmentContext {
  const fake = new FakeSupplier({ shipAfterMs: DAY, deliverAfterMs: 5 * DAY, now: () => clock });
  return {
    db,
    suppliers: suppliersFrom([...extra, fake]),
    mailer,
    orderStatusUrl: (shop, order) => `https://${shop.handle}.example/orders/${order.paymentIntentId}`,
    now: () => new Date(clock),
  };
}

beforeEach(async () => {
  db = await createTestDb();
  clock = Date.now(); // paidAt comes from the real clock in the payment webhook
  mailer = new LogMailer(true);
  ctx = makeCtx();
});

async function shop() {
  const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
  return createShop(db, user.id, { name: "Glow Lamps", country: "US" });
}

async function paidOrder(shopRow: Awaited<ReturnType<typeof shop>>, url: string, addr = address) {
  const product = await importProduct(db, ctx.suppliers, shopRow.id, { url, title: "Thing", prices: {}, publish: true });
  const variant = (await db.query.variants.findFirst({ where: eq(schema.variants.productId, product.id) }))!;
  const payments = new FakePaymentProvider();
  const { order } = await startCheckout(db, payments, shopRow, { email: "ada@example.com", address: addr, lines: [{ variantId: variant.id, quantity: 2 }] });
  const event = await payments.parseWebhook(...Object.values(payments.succeededEvent(order.paymentIntentId!, order.totalMinor)) as [string, string]);
  const res = await handlePaymentEvent(db, "fake", event!);
  expect(res).toMatchObject({ status: "processed", becamePaid: true });
  return order;
}

describe("supplier import", () => {
  it("suggests a price that ends in .99 at about 2.5x cost", () => {
    expect(suggestPrice(412)).toBe(1099);
    expect(suggestPrice(1000)).toBe(2499);
    expect(suggestPrice(10)).toBe(99);
  });

  it("previews a supplier link, imports it with supplier ids, and refuses a second import", async () => {
    const s = await shop();
    const preview = await previewImport(db, ctx.suppliers, s.id, LAMP);
    expect(preview.supplier.label).toBe("Demo supplier");
    expect(preview.product.title).toBe("Sunset Projection Lamp");
    const first = preview.product.variants[0]!;
    expect(preview.suggestedPrices[first.ref]).toBe(suggestPrice(first.costMinor));

    const product = await importProduct(db, ctx.suppliers, s.id, {
      url: LAMP,
      title: "Sunset Lamp",
      prices: { [first.ref]: 2999 },
    });
    expect(product.status).toBe("draft");
    expect(product.supplierProductRef).toBe(preview.product.ref);
    const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, product.id) });
    expect(variants[0]).toMatchObject({ priceMinor: 2999, costMinor: first.costMinor, supplierVariantRef: first.ref });

    expect((await previewImport(db, ctx.suppliers, s.id, LAMP)).alreadyImported?.id).toBe(product.id);
    await expect(importProduct(db, ctx.suppliers, s.id, { url: LAMP, title: "Again", prices: {} })).rejects.toThrow(/already imported/);
  });

  it("won't publish a product priced below cost, and explains unsupported links", async () => {
    const s = await shop();
    const p = await previewImport(db, ctx.suppliers, s.id, STAND);
    const prices = Object.fromEntries(p.product.variants.map((v) => [v.ref, v.costMinor]));
    await expect(importProduct(db, ctx.suppliers, s.id, { url: STAND, title: "Stand", prices, publish: true })).rejects.toThrow(/below the supplier cost/);
    await expect(previewImport(db, ctx.suppliers, s.id, "https://www.amazon.com/dp/B0")).rejects.toThrow(UserError);
    await expect(previewImport(db, ctx.suppliers, s.id, "https://cjdropshipping.com/product/x-p-1234567890AB.html")).rejects.toThrow(/CJ API key/);
    await expect(previewImport(db, ctx.suppliers, s.id, "not a link")).rejects.toThrow(/full product link/);
  });
});

describe("order routing and tracking", () => {
  it("sends a paid order to the supplier, emails the buyer, then tracks it to delivery", async () => {
    const s = await shop();
    const order = await paidOrder(s, LAMP);
    await onOrderPaid(ctx, order.id);
    let full = await getOrder(db, s.id, order.id);
    expect(full.fulfillmentStatus).toBe("sent_to_supplier");
    expect(full.fulfillments).toHaveLength(1);
    expect(full.fulfillments[0]).toMatchObject({ status: "placed", attempts: 1 });
    expect(full.fulfillments[0]!.supplierOrderRef).toMatch(/^DEMO-/);
    expect(mailer.sent.map((m) => m.subject)).toEqual([`Order #${order.number} confirmed`]);
    expect(mailer.sent[0]!.text).toContain(`https://${s.handle}.example/orders/`);

    // Routing again (webhook retry, cron safety net) doesn't place a second supplier order.
    expect((await routeOrder(ctx, order.id)).placed).toBe(0);
    expect((await routeStuckOrders(ctx)).routed).toBe(0);

    // Not shipped yet.
    expect(await syncTracking(ctx)).toMatchObject({ checked: 1, shipped: 0 });
    clock += DAY + 1;
    expect(await syncTracking(ctx)).toMatchObject({ checked: 1, shipped: 1 });
    full = await getOrder(db, s.id, order.id);
    expect(full.fulfillmentStatus).toBe("shipped");
    expect(full.fulfillments[0]).toMatchObject({ status: "shipped", carrier: "Demo Post" });
    expect(mailer.sent.at(-1)!.subject).toBe(`Order #${order.number} is on its way`);
    expect(mailer.sent.at(-1)!.text).toContain(full.fulfillments[0]!.trackingNumber!);

    // A second check doesn't email again.
    await syncTracking(ctx);
    expect(mailer.sent).toHaveLength(2);

    clock += 5 * DAY;
    await syncTracking(ctx);
    full = await getOrder(db, s.id, order.id);
    expect(full.fulfillmentStatus).toBe("delivered");
    expect(full.emails.map((e) => [e.kind, e.status])).toEqual([
      ["order_confirmation", "sent"],
      ["shipping_update", "sent"],
      ["delivered", "sent"],
    ]);
    expect(await syncTracking(ctx)).toMatchObject({ checked: 0 });
  });

  it("turns a supplier refusal into a problem order with a fix, and the merchant can ship it themselves", async () => {
    const s = await shop();
    const order = await paidOrder(s, SOLD_OUT);
    await onOrderPaid(ctx, order.id);
    let full = await getOrder(db, s.id, order.id);
    expect(full.fulfillmentStatus).toBe("problem");
    expect(full.fulfillments[0]).toMatchObject({ status: "failed", problemCode: "out_of_stock" });

    await expect(retryOrder(ctx, s.id, order.id)).rejects.toThrow(/Still failing/);
    expect((await getOrder(db, s.id, order.id)).fulfillments[0]!.attempts).toBe(2);

    await expect(addManualTracking(ctx, s.id, order.id, { carrier: "USPS", trackingNumber: "" })).rejects.toThrow(UserError);
    await addManualTracking(ctx, s.id, order.id, { carrier: "USPS", trackingNumber: "9400 1000", url: "https://tools.usps.com/x" });
    full = await getOrder(db, s.id, order.id);
    expect(full.fulfillmentStatus).toBe("shipped");
    expect(full.fulfillments).toHaveLength(1);
    expect(full.fulfillments[0]).toMatchObject({ status: "shipped", carrier: "USPS", problemCode: null, supplierOrderRef: null });
    expect(mailer.sent.at(-1)!.subject).toContain("is on its way");
    // Manual parcels aren't sent to the supplier for tracking.
    expect(await syncTracking(ctx)).toMatchObject({ checked: 0 });
  });

  it("retries a failure that the supplier later accepts", async () => {
    let wallet = 0;
    const flaky: SupplierAdapter = {
      name: "cj",
      label: "Flaky",
      matchesUrl: (u) => u.hostname === "flaky.test",
      async getProductFromUrl(url) {
        return { ref: "F1", sourceUrl: url, title: "Flaky", description: "", images: [], variants: [{ ref: "F1-v", title: "Default", costMinor: 500, stock: null, shipDaysMin: null, shipDaysMax: null }] };
      },
      async placeOrder() {
        if (wallet < 10) throw new SupplierError("insufficient_balance", "Wallet is empty.");
        return { supplierOrderRef: "F-1" };
      },
      async getTracking() {
        return null;
      },
    };
    ctx = makeCtx([flaky]);
    const s = await shop();
    const order = await paidOrder(s, "https://flaky.test/p/1");
    await routeOrder(ctx, order.id);
    expect((await getOrder(db, s.id, order.id)).fulfillments[0]).toMatchObject({ problemCode: "insufficient_balance" });
    wallet = 100;
    await retryOrder(ctx, s.id, order.id);
    const full = await getOrder(db, s.id, order.id);
    expect(full.fulfillmentStatus).toBe("sent_to_supplier");
    expect(full.fulfillments[0]).toMatchObject({ status: "placed", supplierOrderRef: "F-1", problemCode: null });
  });

  it("flags an order the supplier hasn't shipped after a week, and clears it when tracking appears", async () => {
    ctx = { ...ctx, suppliers: suppliersFrom([new FakeSupplier({ shipAfterMs: 9 * DAY, deliverAfterMs: 20 * DAY, now: () => clock })]) };
    const s = await shop();
    const order = await paidOrder(s, LAMP);
    await routeOrder(ctx, order.id);
    clock += 8 * DAY;
    expect(await syncTracking(ctx)).toMatchObject({ late: 1 });
    expect((await getOrder(db, s.id, order.id)).fulfillmentStatus).toBe("problem");
    clock += 2 * DAY;
    await syncTracking(ctx);
    const full = await getOrder(db, s.id, order.id);
    expect(full.fulfillmentStatus).toBe("shipped");
    expect(full.fulfillments[0]!.problemCode).toBeNull();
  });

  it("flags a country the supplier can't ship to, and won't retry another store's order", async () => {
    const s = await shop();
    const order = await paidOrder(s, STAND, { ...address, country: "JP" });
    await routeOrder(ctx, order.id);
    expect((await getOrder(db, s.id, order.id)).fulfillments[0]).toMatchObject({ problemCode: "address_unsupported" });

    await expect(retryOrder(ctx, "00000000-0000-0000-0000-000000000000", order.id)).rejects.toThrow(/not found/);
  });

  it("picks up a paid order whose routing never ran", async () => {
    const s = await shop();
    const order = await paidOrder(s, LAMP);
    expect((await routeStuckOrders(ctx)).routed).toBe(0); // too recent
    clock += 5 * 60_000;
    expect((await routeStuckOrders(ctx)).routed).toBe(1);
    expect((await getOrder(db, s.id, order.id)).fulfillmentStatus).toBe("sent_to_supplier");
  });
});

describe("CJ Dropshipping adapter", () => {
  function cj(responses: Record<string, unknown>) {
    const calls: { url: string; body?: unknown; token?: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname.replace("/api2.0/v1", "");
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined, token: (init.headers as Record<string, string>)["CJ-Access-Token"] });
      const data = responses[path];
      if (data instanceof Error) return new Response(JSON.stringify({ code: 1600200, result: false, message: data.message, data: null }));
      return new Response(JSON.stringify({ code: 200, result: true, message: "Success", data }));
    }) as unknown as typeof fetch;
    return { adapter: new CjSupplier({ apiKey: "k", fetch: f, now: () => clock }), calls };
  }
  const auth = { "/authentication/getAccessToken": { accessToken: "tok", accessTokenExpiryDate: "2026-10-20T00:00:00Z" } };

  it("reads a product page and keeps one access token", async () => {
    const { adapter, calls } = cj({
      ...auth,
      "/product/query": {
        pid: "ABC123DEF456",
        productNameEn: "Mini Projector",
        description: "<p>Bright &amp; small</p><script>x()</script>",
        productImageSet: ["https://cf.cjdropshipping.com/a.jpg", "http://insecure/b.jpg"],
        variants: [{ vid: "V1", variantKey: "Black", variantSellPrice: "12.34" }],
      },
    });
    const url = "https://cjdropshipping.com/product/mini-projector-p-ABC123DEF456.html";
    expect(adapter.matchesUrl(new URL(url))).toBe(true);
    const p = await adapter.getProductFromUrl(url);
    expect(p).toMatchObject({ ref: "ABC123DEF456", title: "Mini Projector", description: "Bright & small", images: ["https://cf.cjdropshipping.com/a.jpg"] });
    expect(p.variants[0]).toMatchObject({ ref: "V1", title: "Black", costMinor: 1234 });
    await adapter.getProductFromUrl(url);
    expect(calls.filter((c) => c.url.includes("getAccessToken"))).toHaveLength(1);
    expect(calls.at(-1)!.token).toBe("tok");
  });

  it("places an order with the cheapest shipping and our reference, and maps errors", async () => {
    const { adapter, calls } = cj({
      ...auth,
      "/logistic/freightCalculate": [{ logisticName: "Slow", logisticPrice: 2 }, { logisticName: "Fast", logisticPrice: 9 }],
      "/shopping/order/createOrderV2": { orderId: "CJ-9" },
      "/shopping/order/getOrderDetail": { orderStatus: "SHIPPED", trackNumber: "CJPKL1", logisticName: "CJPacket" },
    });
    const res = await adapter.placeOrder({ reference: "ful-1", email: "a@b.co", address, lines: [{ variantRef: "V1", quantity: 2 }] });
    expect(res.supplierOrderRef).toBe("CJ-9");
    const body = calls.find((c) => c.url.includes("createOrderV2"))!.body as Record<string, unknown>;
    expect(body).toMatchObject({ orderNumber: "ful-1", logisticName: "Slow", shippingCountryCode: "US", products: [{ vid: "V1", quantity: 2 }] });
    expect(await adapter.getTracking("CJ-9")).toMatchObject({ status: "in_transit", trackingNumber: "CJPKL1" });

    const broke = cj({ ...auth, "/logistic/freightCalculate": [{ logisticName: "A", logisticPrice: 1 }], "/shopping/order/createOrderV2": new Error("Insufficient balance") });
    await expect(broke.adapter.placeOrder({ reference: "r", email: "a@b.co", address, lines: [] })).rejects.toMatchObject({ code: "insufficient_balance" });
  });

  it("strips supplier HTML to text", () => {
    expect(htmlToText("<ul><li>One</li><li>Two</li></ul><p>A&nbsp;B</p>")).toBe("• One\n• Two\nA B");
  });
});
