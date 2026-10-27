import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  createProduct,
  DemoModel,
  handlePaymentEvent,
  inDeliveryArea,
  LOCAL_DELIVERY_RATE_ID,
  markDeliveredByStore,
  onOrderPaid,
  ordersWaitingForTracking,
  quoteCart,
  setDeliveryProtection,
  setLocalDelivery,
  startCheckout,
} from "../src";
import { makeFixture } from "../evals/fixture";

const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 9 }] });
  const [mugVariant] = await f.variants(mug.id);
  const [lampVariant] = await f.variants(f.products.lamp.id);
  await setLocalDelivery(f.db, shopId, { postalPrefixes: "787, 7860\n78612", priceMinor: 400, freeOverMinor: 4000, note: "Dropped off within 2 days" });
  async function checkout(opts: { quantity?: number; variantId?: string; postalCode?: string; shippingRateId?: string | null; protection?: boolean } = {}) {
    return startCheckout(f.db, f.payments, await f.shop(), {
      email: "buyer@example.com",
      address: { ...austin, postalCode: opts.postalCode ?? austin.postalCode },
      lines: [{ variantId: opts.variantId ?? mugVariant!.id, quantity: opts.quantity ?? 1 }],
      shippingRateId: opts.shippingRateId,
      protection: opts.protection,
    });
  }
  async function pay(orderId: string) {
    const order = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) }))!;
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  }
  return { ...f, shopId, mugVariant: mugVariant!, lampVariant: lampVariant!, checkout, pay };
}

describe("local delivery", () => {
  it("is offered to postal codes in the area for the store's own stock, at its price, free over the amount", async () => {
    const f = await setup();
    expect((await f.shop()).localDeliveryArea).toEqual({ postalPrefixes: ["7860", "78612", "787"], priceMinor: 400, freeOverMinor: 4000, note: "Dropped off within 2 days" });
    expect(inDeliveryArea({ postalPrefixes: ["SW1"] }, "sw1a 1aa")).toBe(true);
    expect(inDeliveryArea({ postalPrefixes: ["SW1"] }, "SE1 7PB")).toBe(false);

    const lines = [{ variantId: f.mugVariant.id, quantity: 1 }];
    const quote = await quoteCart(f.db, await f.shop(), lines, { country: "US", postalCode: "78701" });
    expect(quote.canDeliverLocally).toBe(true);
    expect(quote.shipping!.rateId).not.toBe(LOCAL_DELIVERY_RATE_ID);
    expect((await quoteCart(f.db, await f.shop(), lines, { country: "US", postalCode: "10001" })).canDeliverLocally).toBe(false);
    expect((await quoteCart(f.db, await f.shop(), [...lines, { variantId: f.lampVariant.id, quantity: 1 }], { country: "US", postalCode: "78701" })).canDeliverLocally).toBe(false);

    await setDeliveryProtection(f.db, f.shopId, { percent: 3, minMinor: 100 });
    const { order } = await f.checkout({ shippingRateId: LOCAL_DELIVERY_RATE_ID, protection: true });
    expect(order).toMatchObject({ localDelivery: true, shippingMinor: 400, protectionMinor: 0, shippingMethod: "Local delivery" });
    expect((await f.checkout({ quantity: 3, shippingRateId: LOCAL_DELIVERY_RATE_ID })).order.shippingMinor).toBe(0);
    // Outside the area it ships as usual.
    const far = (await f.checkout({ postalCode: "73301", shippingRateId: LOCAL_DELIVERY_RATE_ID })).order;
    expect(far.localDelivery).toBe(false);
    expect(far.shippingMethod).not.toBe("Local delivery");
  });

  it("stays out of the tracking list and is marked delivered by the store", async () => {
    const f = await setup();
    const order = await f.pay((await f.checkout({ shippingRateId: LOCAL_DELIVERY_RATE_ID })).order.id);
    expect(f.mailer.sent.find((m) => m.subject === `Order #${order.number} confirmed`)!.text).toContain("Glow Lamps is delivering it to you themselves (Dropped off within 2 days)");
    expect((await ordersWaitingForTracking(f.db, f.shopId)).map((o) => o.id)).not.toContain(order.id);

    await markDeliveredByStore(f.ctx, f.shopId, order.id);
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.fulfillmentStatus).toBe("delivered");
    expect(f.mailer.sent.filter((m) => m.subject === `Order #${order.number} was delivered`)).toHaveLength(1);
    await expect(markDeliveredByStore(f.ctx, f.shopId, order.id)).rejects.toThrow("already delivered");

    const courier = await f.pay((await f.checkout()).order.id);
    await expect(markDeliveredByStore(f.ctx, f.shopId, courier.id)).rejects.toThrow("goes by courier");
  });

  it("checks the area and price", async () => {
    const f = await setup();
    await expect(setLocalDelivery(f.db, f.shopId, { postalPrefixes: " , ", priceMinor: 400 })).rejects.toThrow("Add the postal codes");
    await expect(setLocalDelivery(f.db, f.shopId, { postalPrefixes: "787, 78#", priceMinor: 400 })).rejects.toThrow(`"78#"`);
    await expect(setLocalDelivery(f.db, f.shopId, { postalPrefixes: "787", priceMinor: -1 })).rejects.toThrow("between 0 and 1,000");
    expect(await setLocalDelivery(f.db, f.shopId, { postalPrefixes: ["sw1a", "SW1A", "e1-6"], priceMinor: 0 })).toEqual({ postalPrefixes: ["E16", "SW1A"], priceMinor: 0, freeOverMinor: null, note: null });
    await setLocalDelivery(f.db, f.shopId, null);
    expect((await f.shop()).localDeliveryArea).toBeNull();
  });
});
