import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { addManualTracking, parcelDeliveries, createGiftCardProduct, createProduct, DemoModel, getOrder, handlePaymentEvent, onOrderPaid, orderParcels, quoteCart, startCheckout, syncTracking } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("orders in more than one parcel", () => {
  it("counts a parcel per supplier and the store's own shelf, and lists each with its tracking", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, f.products.stand.id));
    const [stand] = await f.variants(f.products.stand.id);
    const own = await createProduct(f.db, shop.id, { title: "Handmade Coaster", status: "active", variants: [{ priceMinor: 900, stock: 10 }] });
    const [coaster] = await f.variants(own.id);
    const card = await createGiftCardProduct(f.db, shop, [2500]);
    const [gift] = await f.variants(card.id);

    // Two things from the same supplier come together; a gift card doesn't ship at all.
    expect((await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 1 }, { variantId: stand!.id, quantity: 1 }])).parcels).toBe(1);
    expect((await quoteCart(f.db, shop, [{ variantId: lamp!.id, quantity: 1 }, { variantId: gift!.id, quantity: 1 }])).parcels).toBe(1);
    // The store's own coaster is a second parcel.
    const lines = [{ variantId: lamp!.id, quantity: 2 }, { variantId: coaster!.id, quantity: 1 }, { variantId: stand!.id, quantity: 1 }];
    expect((await quoteCart(f.db, shop, lines)).parcels).toBe(2);

    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines, storefront: true });
    let full = await getOrder(f.db, shop.id, order.id);
    let parcels = await orderParcels(f.db, full);
    expect(parcels.map((p) => [p.key === "own" ? "own" : "supplier", p.items.map((i) => `${i.title} × ${i.quantity}`).sort(), p.shipment])).toEqual([
      ["supplier", [expect.stringMatching(/Magnetic Phone Stand.* × 1/), expect.stringMatching(/Sunset Projection Lamp.* × 2/)].sort(), null],
      ["own", [expect.stringMatching(/Handmade Coaster.* × 1/)], null],
    ]);

    // The supplier ships its parcel: that one shows first, with its tracking.
    const supplierId = f.products.lamp.supplierId!;
    await f.db.insert(schema.fulfillments).values({ shopId: shop.id, orderId: order.id, supplierId, status: "shipped", carrier: "YunExpress", trackingNumber: "YT123", shippedAt: new Date() });
    await f.db.insert(schema.fulfillments).values({ shopId: shop.id, orderId: order.id, supplierId: null, status: "pending" });
    full = await getOrder(f.db, shop.id, order.id);
    parcels = await orderParcels(f.db, full);
    expect(parcels[0]!.key).toBe(supplierId);
    expect(parcels[0]!.shipment).toMatchObject({ status: "shipped", carrier: "YunExpress", trackingNumber: "YT123" });
    expect(parcels[1]!.shipment).toMatchObject({ status: "pending", trackingNumber: null });

    // One parcel: nothing to list.
    await f.db.delete(schema.orderLines).where(eq(schema.orderLines.variantId, coaster!.id));
    expect(await orderParcels(f.db, await getOrder(f.db, shop.id, order.id))).toEqual([]);
  });

  it("emails each parcel as it ships, and says delivered only once the last one arrives", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    const own = await createProduct(f.db, shop.id, { title: "Handmade Coaster", status: "active", variants: [{ priceMinor: 900, stock: 10 }] });
    const [coaster] = await f.variants(own.id);
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: lamp!.id, quantity: 2 }, { variantId: coaster!.id, quantity: 1 }], storefront: true });
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    const mail = () => f.mailer.sent.filter((m) => m.to === "ada@example.com" && /on its way|delivered/.test(m.subject));

    // The supplier ships the lamps first.
    f.advance(86_400_000 + 1);
    await syncTracking(f.ctx, { orderId: order.id });
    expect(mail().map((m) => m.subject)).toEqual([`Order #${order.number}: parcel 1 of 2 is on its way`]);
    const first = mail()[0]!.text;
    expect(first).toContain("comes in 2 parcels");
    expect(first).toMatch(/Parcel 1 has shipped with:\n\n  Sunset Projection Lamp.* × 2/);
    expect(first).toMatch(/Still to come in a separate parcel:\n  Handmade Coaster\n/);
    expect(first).toMatch(/Expected delivery: [A-Z][a-z]{2} \d{1,2}( – [A-Z][a-z]{2} \d{1,2})?\n/);
    // Each parcel has its own dates: the shipped one counts from when it left.
    const full = await getOrder(f.db, shop.id, order.id);
    const parcels = await orderParcels(f.db, full);
    // The store's own coaster goes by a local courier in 2 to 3 days.
    await f.db.update(schema.variants).set({ shipDaysMin: 2, shipDaysMax: 3 }).where(eq(schema.variants.id, coaster!.id));
    const dates = await parcelDeliveries(f.db, shop, full, parcels);
    const shipped = parcels.find((p) => p.shipment?.trackingNumber)!;
    const waiting = parcels.find((p) => p.key === "own")!;
    const day = 86_400_000;
    expect(dates.get(shipped.key)!.from.getTime()).toBeGreaterThanOrEqual(shipped.shipment!.shippedAt!.getTime() + 6 * day - day);
    expect(dates.get(waiting.key)).toBeTruthy();
    expect(dates.get(waiting.key)!.from.getTime()).not.toBe(dates.get(shipped.key)!.from.getTime());
    // The coaster hasn't gone out, so the order isn't "shipped" and stays on the list to send.
    const status = async () => (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.fulfillmentStatus;
    expect(await status()).toBe("partially_shipped");
    // Checking again sends nothing new.
    await syncTracking(f.ctx, { orderId: order.id });
    expect(mail()).toHaveLength(1);

    // The merchant posts the coaster.
    await addManualTracking(f.ctx, shop.id, order.id, { carrier: "USPS", trackingNumber: "9400111", url: "" });
    expect(mail().map((m) => m.subject).at(-1)).toBe(`Order #${order.number}: parcel 2 of 2 is on its way`);
    expect(mail().at(-1)!.text).toContain("USPS: 9400111");
    expect(mail().at(-1)!.text).toContain("this is the last parcel");
    expect(await status()).toBe("shipped");

    // The lamps arrive, but the coaster hasn't: no "delivered" yet.
    f.advance(6 * 86_400_000);
    await syncTracking(f.ctx, { orderId: order.id });
    expect(mail().some((m) => m.subject.includes("delivered"))).toBe(false);
    expect(await status()).toBe("shipped");
  });

  it("posts the store's own parcel without touching a supplier's", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    const own = await createProduct(f.db, shop.id, { title: "Handmade Coaster", status: "active", variants: [{ priceMinor: 900, stock: 10 }] });
    const [coaster] = await f.variants(own.id);
    const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines: [{ variantId: lamp!.id, quantity: 1 }, { variantId: coaster!.id, quantity: 1 }], storefront: true });
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    // Even with the supplier's parcel failed, the own parcel's tracking goes on a parcel of its own.
    await f.db.update(schema.fulfillments).set({ status: "failed", problemCode: "out_of_stock", problemMessage: "Out of stock" }).where(eq(schema.fulfillments.orderId, order.id));
    await addManualTracking(f.ctx, shop.id, order.id, { carrier: "USPS", trackingNumber: "9400111", own: true });
    const rows = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) });
    expect(rows.map((r) => [r.supplierId === null ? "own" : "supplier", r.status, r.trackingNumber]).sort()).toEqual([["own", "shipped", "9400111"], ["supplier", "failed", null]]);
    // Again: it updates that parcel instead of adding another.
    await addManualTracking(f.ctx, shop.id, order.id, { carrier: "USPS", trackingNumber: "9400222", own: true });
    const again = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) });
    expect(again.filter((r) => r.supplierId === null).map((r) => r.trackingNumber)).toEqual(["9400222"]);
  });
});
