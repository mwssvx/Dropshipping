import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { acceptPostPurchaseOffer, createShop, DemoModel, exportStore, importStore, signUp, FakePaymentProvider, onOrderPaid, percentOff, postPurchaseOfferFor, postPurchaseOrder, postPurchaseStats, setPostPurchaseOffer } from "../src";
import { makeFixture } from "../evals/fixture";

describe("after-checkout offer", () => {
  it("adds one product to the same card right after paying, once", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const stand = f.products.stand;
    await expect(setPostPurchaseOffer(f.db, shopId, { productId: null, percentOff: 20, active: true })).rejects.toThrow("Pick a product");
    await expect(setPostPurchaseOffer(f.db, shopId, { productId: stand.id, percentOff: 60, active: true })).rejects.toThrow("50% off or less");
    await expect(setPostPurchaseOffer(f.db, shopId, { productId: stand.id, percentOff: 20, active: true })).rejects.toThrow("isn't on sale");

    // An order paid before the offer was on didn't keep the card, so it gets no offer.
    const before = await f.waitingOrder();
    await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, stand.id));
    await setPostPurchaseOffer(f.db, shopId, { productId: stand.id, percentOff: 20, active: true });
    expect(await postPurchaseOfferFor(f.db, await f.shop(), before)).toBeNull();

    const order = await f.waitingOrder();
    expect(order.cardSaved).toBe(true);
    const offer = (await postPurchaseOfferFor(f.db, await f.shop(), order))!;
    const [standVariant] = await f.variants(stand.id);
    expect(offer).toMatchObject({ product: { id: stand.id }, percentOff: 20 });
    expect(offer.variants[0]).toMatchObject({ id: standVariant!.id, priceMinor: standVariant!.priceMinor, offerMinor: percentOff(standVariant!.priceMinor, 20) });
    // Texas sales tax is added on top, so the charge says so.
    expect(offer.variants[0]!.chargeMinor).toBeGreaterThanOrEqual(offer.variants[0]!.offerMinor);
    expect(await postPurchaseOfferFor(f.db, await f.shop(), order, { now: new Date(order.paidAt!.getTime() + 16 * 60_000) })).toBeNull();

    // A declined card leaves nothing behind, and the offer stays.
    (f.payments as FakePaymentProvider).declineNextCharge = true;
    await expect(acceptPostPurchaseOffer(f.ctx, await f.shop(), { orderRef: order.paymentIntentId!, variantId: standVariant!.id })).rejects.toThrow("declined");
    expect(await f.db.query.orders.findFirst({ where: eq(schema.orders.parentOrderId, order.id) })).toBeUndefined();

    const added = await acceptPostPurchaseOffer(f.ctx, await f.shop(), { orderRef: order.paymentIntentId!, variantId: standVariant!.id });
    await onOrderPaid(f.ctx, added.id);
    expect(added).toMatchObject({ source: "post_purchase", parentOrderId: order.id, paymentStatus: "paid", shippingMinor: 0, discountMinor: 0, totalMinor: offer.variants[0]!.chargeMinor, number: order.number + 1 });
    expect(await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, added.id) })).toEqual([expect.objectContaining({ variantId: standVariant!.id, unitPriceMinor: offer.variants[0]!.offerMinor, quantity: 1 })]);
    expect(await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, added.id) })).toHaveLength(1);
    const receipt = f.mailer.sent.find((m) => m.subject === `Order #${added.number} confirmed`);
    expect(receipt?.text).toContain(`You added this after checkout, so it's charged to the same card. It may arrive separately from order #${order.number}.`);
    expect((await postPurchaseOrder(f.db, order.id))?.id).toBe(added.id);

    await expect(acceptPostPurchaseOffer(f.ctx, await f.shop(), { orderRef: order.paymentIntentId!, variantId: standVariant!.id })).rejects.toThrow("already added");
    expect(await postPurchaseOfferFor(f.db, await f.shop(), order)).toBeNull();
    expect(await postPurchaseStats(f.db, shopId)).toEqual({ orders: 1, revenueMinor: added.totalMinor });

    // Store files carry it by product handle.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shopId)));
    expect(file.store.after_checkout_offer).toEqual({ product: stand.handle, percent_off: 20, active: true });
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const copied = (await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!;
    expect(copied.postPurchaseOffer).toMatchObject({ percentOff: 20, active: true });

    // Turning it off clears the setting.
    await setPostPurchaseOffer(f.db, shopId, { productId: null, percentOff: 0, active: false });
    expect((await f.shop()).postPurchaseOffer).toBeNull();
  });
});
