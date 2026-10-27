import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  createProduct,
  DemoModel,
  handlePaymentEvent,
  importTracking,
  markPickedUp,
  markReadyForPickup,
  onOrderPaid,
  ordersWaitingForTracking,
  PICKUP_RATE_ID,
  quoteCart,
  setDeliveryProtection,
  setLocalPickup,
  startCheckout,
} from "../src";
import { makeFixture } from "../evals/fixture";

const austin = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const mug = await createProduct(f.db, shopId, { title: "Mug", status: "active", variants: [{ title: "Default", priceMinor: 1500, stock: 5 }] });
  const [mugVariant] = await f.variants(mug.id);
  const [lampVariant] = await f.variants(f.products.lamp.id);
  await setLocalPickup(f.db, shopId, { address: "Glow Lamps Studio\n12 Congress Ave, Austin", instructions: "Ring the bell, weekdays 10–6." });
  async function checkout(opts: { variantId?: string; country?: string; shippingRateId?: string | null; protection?: boolean } = {}) {
    const address = opts.country === "CA" ? { ...austin, city: "Ottawa", region: "ON", postalCode: "K1A 0B1", country: "CA" } : austin;
    return startCheckout(f.db, f.payments, await f.shop(), {
      email: "buyer@example.com",
      address,
      lines: [{ variantId: opts.variantId ?? mugVariant!.id, quantity: 1 }],
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
  return { ...f, shopId, mug, mugVariant: mugVariant!, lampVariant: lampVariant!, checkout, pay };
}

describe("local pickup", () => {
  it("is a free choice at checkout for the store's own stock in its country, never the default", async () => {
    const f = await setup();
    const quote = await quoteCart(f.db, await f.shop(), [{ variantId: f.mugVariant.id, quantity: 1 }], { country: "US" });
    expect(quote.canPickUp).toBe(true);
    expect(quote.pickingUp).toBe(false);
    expect(quote.shipping!.rateId).not.toBe(PICKUP_RATE_ID);
    expect(quote.shippingMinor).toBeGreaterThan(0);

    await setDeliveryProtection(f.db, f.shopId, { percent: 3, minMinor: 100 });
    const { order } = await f.checkout({ shippingRateId: PICKUP_RATE_ID, protection: true });
    expect(order).toMatchObject({ pickup: true, shippingMinor: 0, protectionMinor: 0, shippingMethod: "Local pickup" });
    expect(order.totalMinor).toBe(order.subtotalMinor + order.taxMinor);

    // Supplier items ship from the supplier; buyers abroad can't come by; and it can be turned off.
    expect((await quoteCart(f.db, await f.shop(), [{ variantId: f.mugVariant.id, quantity: 1 }, { variantId: f.lampVariant.id, quantity: 1 }], { country: "US" })).canPickUp).toBe(false);
    const mixed = await f.checkout({ variantId: f.lampVariant.id, shippingRateId: PICKUP_RATE_ID });
    expect(mixed.order.pickup).toBe(false);
    expect(mixed.order.shippingMinor).toBeGreaterThan(0);
    expect((await quoteCart(f.db, await f.shop(), [{ variantId: f.mugVariant.id, quantity: 1 }], { country: "CA" })).canPickUp).toBe(false);
    await setLocalPickup(f.db, f.shopId, null);
    expect((await f.checkout({ shippingRateId: PICKUP_RATE_ID })).order.pickup).toBe(false);
  });

  it("emails the buyer when it's ready and marks it delivered when it's picked up", async () => {
    const f = await setup();
    const order = await f.pay((await f.checkout({ shippingRateId: PICKUP_RATE_ID })).order.id);
    expect(order.fulfillmentStatus).toBe("unfulfilled");
    const confirmation = f.mailer.sent.find((m) => m.subject === `Order #${order.number} confirmed`)!;
    expect(confirmation.text).toContain("You're picking it up from Glow Lamps");
    expect(confirmation.text).not.toContain("when it ships");
    // It never needs tracking, so it isn't in the spreadsheet of orders waiting for it.
    expect((await ordersWaitingForTracking(f.db, f.shopId)).map((o) => o.id)).not.toContain(order.id);
    const file = `Order,Carrier,Tracking number\n${order.number},USPS,9400111899223100001234`;
    expect((await importTracking(f.ctx, f.shopId, file)).skipped[0]!.reason).toContain("picking this order up");

    await markReadyForPickup(f.ctx, f.shopId, order.id);
    const ready = f.mailer.sent.filter((m) => m.subject === `Order #${order.number} is ready to pick up`);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.text).toContain("  12 Congress Ave, Austin");
    expect(ready[0]!.text).toContain("Ring the bell, weekdays 10–6.");
    await expect(markReadyForPickup(f.ctx, f.shopId, order.id)).rejects.toThrow("already told");

    await markPickedUp(f.ctx, f.shopId, order.id);
    const done = (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    expect(done.fulfillmentStatus).toBe("delivered");
    expect(await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) })).toMatchObject([{ status: "delivered", carrier: "Local pickup", supplierId: null }]);
    expect(f.mailer.sent.filter((m) => m.subject === `Order #${order.number} was picked up`)).toHaveLength(1);
    await expect(markPickedUp(f.ctx, f.shopId, order.id)).rejects.toThrow("already picked up");
  });

  it("refuses orders that aren't picked up or aren't paid, and checks the settings", async () => {
    const f = await setup();
    const shipped = await f.pay((await f.checkout()).order.id);
    await expect(markReadyForPickup(f.ctx, f.shopId, shipped.id)).rejects.toThrow("being shipped");
    const unpaid = (await f.checkout({ shippingRateId: PICKUP_RATE_ID })).order;
    await expect(markPickedUp(f.ctx, f.shopId, unpaid.id)).rejects.toThrow("isn't paid");

    await expect(setLocalPickup(f.db, f.shopId, { address: "  " })).rejects.toThrow("Enter the address");
    await expect(setLocalPickup(f.db, f.shopId, { address: "x".repeat(301) })).rejects.toThrow("under 300");
    expect(await setLocalPickup(f.db, f.shopId, { address: " 1 Main St\r\nAustin ", instructions: "  " })).toEqual({ address: "1 Main St\nAustin", instructions: null });
  });
});
