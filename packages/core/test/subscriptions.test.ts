import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  cancelSubscriptionForBuyer,
  changeSubscription,
  DemoModel,
  exportStore,
  FakePaymentProvider,
  getSubscriptionByToken,
  listSubscriptions,
  percentOff,
  renewSubscription,
  runDueSubscriptions,
  sendSubscriptionReminders,
  setSubscriptionOffer,
  startSubscription,
  subscriptionForOrder,
  subscriptionOfferFor,
  subscriptionStats,
  type SubscriptionContext,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

describe("subscribe and save", () => {
  it("sends the order again on a schedule, for less, to the saved card", async () => {
    const f = await makeFixture(new DemoModel());
    const ctx: SubscriptionContext = { ...f.ctx, manageUrl: (shop, token) => `https://${shop.handle}.example/subscriptions/${token}` };
    const shopId = (await f.shop()).id;
    await expect(setSubscriptionOffer(f.db, shopId, { percentOff: 35, active: true })).rejects.toThrow("30% off or less");

    // Paid before it was on, so the card wasn't kept: no offer.
    const before = await f.waitingOrder();
    expect(before.cardSaved).toBe(false);
    await setSubscriptionOffer(f.db, shopId, { percentOff: 10, active: true });
    expect(await subscriptionOfferFor(f.db, await f.shop(), before)).toBeNull();

    const order = await f.waitingOrder();
    expect(order.cardSaved).toBe(true);
    const [lampVariant] = await f.variants(f.products.lamp.id);
    const offer = (await subscriptionOfferFor(f.db, await f.shop(), order))!;
    expect(offer.percentOff).toBe(10);
    expect(offer.items).toEqual([expect.objectContaining({ variantId: lampVariant!.id, quantity: 1, priceMinor: lampVariant!.priceMinor, offerMinor: percentOff(lampVariant!.priceMinor, 10) })]);
    expect(offer.shippingMinor).toBe(order.shippingMinor);
    expect(offer.eachMinor).toBe(offer.goodsMinor + offer.shippingMinor);
    // Only for a week after paying.
    expect(await subscriptionOfferFor(f.db, await f.shop(), order, { now: new Date(order.paidAt!.getTime() + 8 * DAY) })).toBeNull();

    const shop = await f.shop();
    const now = new Date(f.ctx.now!());
    await expect(startSubscription(ctx, shop, { orderRef: order.paymentIntentId!, intervalDays: 45 })).rejects.toThrow("Pick how often");
    const sub = await startSubscription(ctx, shop, { orderRef: order.paymentIntentId!, intervalDays: 30 }, { now });
    expect(sub).toMatchObject({ status: "active", intervalDays: 30, percentOff: 10, email: order.email, lines: [{ variantId: lampVariant!.id, quantity: 1 }] });
    expect(sub.nextOrderAt.getTime()).toBe(now.getTime() + 30 * DAY);
    const welcome = f.mailer.sent.find((m) => m.subject === "You're subscribed to Glow Lamps");
    expect(welcome?.text).toContain(`https://${shop.handle}.example/subscriptions/${sub.token}`);
    expect(welcome?.text).toContain("Every month, we'll send you:");
    await expect(startSubscription(ctx, shop, { orderRef: order.paymentIntentId!, intervalDays: 30 })).rejects.toThrow("already subscribed");
    expect(await subscriptionOfferFor(f.db, shop, order)).toBeNull();
    expect((await subscriptionForOrder(f.db, order.id))?.id).toBe(sub.id);

    // A reminder three days before, once.
    expect((await sendSubscriptionReminders(ctx, { now })).sent).toBe(0);
    const soon = new Date(now.getTime() + 28 * DAY);
    expect((await sendSubscriptionReminders(ctx, { now: soon })).sent).toBe(1);
    expect((await sendSubscriptionReminders(ctx, { now: soon })).sent).toBe(0);
    const reminder = f.mailer.sent.find((m) => m.subject.startsWith("Your next Glow Lamps delivery is on"));
    expect(reminder?.text).toContain("Want to skip this one");

    // Due: a new paid order at the subscription price, sent to the supplier.
    f.advance(30 * DAY + 1);
    expect(await runDueSubscriptions(ctx)).toEqual({ reminded: 0, ordered: 1, failed: 0 });
    const repeat = (await f.db.query.orders.findFirst({ where: eq(schema.orders.subscriptionId, sub.id) }))!;
    expect(repeat).toMatchObject({ source: "subscription", paymentStatus: "paid", discountMinor: 0, shippingMinor: order.shippingMinor, number: order.number + 1, email: order.email });
    expect(await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, repeat.id) })).toEqual([
      expect.objectContaining({ variantId: lampVariant!.id, unitPriceMinor: percentOff(lampVariant!.priceMinor, 10), quantity: 1 }),
    ]);
    expect(await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, repeat.id) })).toHaveLength(1);
    expect(f.mailer.sent.find((m) => m.subject === `Order #${repeat.number} confirmed`)?.text).toContain("This is a delivery from your subscription");
    let saved = (await f.db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, sub.id) }))!;
    expect(saved.nextOrderAt.getTime()).toBe(f.ctx.now!().getTime() + 30 * DAY);
    // Running again the same day does nothing.
    expect(await runDueSubscriptions(ctx)).toEqual({ reminded: 0, ordered: 0, failed: 0 });

    // A declined card is tried again in two days; after three in a row it pauses and the buyer hears.
    const fake = f.payments as FakePaymentProvider;
    for (let i = 1; i <= 3; i++) {
      fake.declineNextCharge = true;
      const r = await renewSubscription(ctx, sub.id);
      expect(r).toMatchObject({ status: "failed", paused: i === 3 });
    }
    saved = (await f.db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, sub.id) }))!;
    expect(saved).toMatchObject({ status: "paused", pausedBy: "payment", failures: 3 });
    expect(saved.lastError).toContain("declined");
    expect(await f.db.query.orders.findMany({ where: eq(schema.orders.subscriptionId, sub.id) })).toHaveLength(1);
    expect(f.mailer.sent.find((m) => m.subject === "Your Glow Lamps subscription is paused")?.text).toContain("Nothing was charged");

    // The buyer's page: resume, skip, change how often, pause, cancel.
    const at = f.ctx.now!();
    let view = await changeSubscription(f.db, shop, sub.token, { type: "resume" }, { now: at });
    expect(view).toMatchObject({ status: "active", failures: 0, lastError: null });
    expect(view.items).toEqual([expect.objectContaining({ title: expect.stringContaining("Sunset Projection Lamp"), available: true })]);
    expect(view.orders.map((o) => o.number)).toEqual([repeat.number]);
    const next = view.nextOrderAt.getTime();
    view = await changeSubscription(f.db, shop, sub.token, { type: "skip" }, { now: at });
    expect(view.nextOrderAt.getTime()).toBe(next + 30 * DAY);
    view = await changeSubscription(f.db, shop, sub.token, { type: "interval", days: 14 }, { now: at });
    expect(view).toMatchObject({ intervalDays: 14 });
    expect(view.nextOrderAt.getTime()).toBe(next + 14 * DAY);
    await expect(changeSubscription(f.db, shop, sub.token, { type: "interval", days: 3 })).rejects.toThrow("Pick how often");
    view = await changeSubscription(f.db, shop, sub.token, { type: "pause" }, { now: at });
    expect(view).toMatchObject({ status: "paused", pausedBy: "buyer" });
    await expect(changeSubscription(f.db, shop, sub.token, { type: "skip" })).rejects.toThrow("Resume");
    expect((await renewSubscription(ctx, sub.id)).status).toBe("skipped");
    view = await changeSubscription(f.db, shop, sub.token, { type: "cancel" }, { now: at });
    expect(view.status).toBe("cancelled");
    await expect(changeSubscription(f.db, shop, sub.token, { type: "resume" })).rejects.toThrow("cancelled");
    await expect(getSubscriptionByToken(f.db, shop, "nope")).rejects.toThrow();

    // The merchant's view.
    const second = await f.waitingOrder();
    const other = await startSubscription(ctx, shop, { orderRef: second.paymentIntentId!, intervalDays: 60 });
    const list = await listSubscriptions(f.db, shopId);
    expect(list.map((s) => [s.id, s.deliveries, s.salesMinor, s.firstOrderNumber])).toEqual([
      [other.id, 0, 0, second.number],
      [sub.id, 1, repeat.totalMinor, order.number],
    ]);
    expect(await subscriptionStats(f.db, shopId)).toEqual({ active: 1, orders: 1, salesMinor: repeat.totalMinor });
    await cancelSubscriptionForBuyer(ctx, shop, other.id);
    await expect(cancelSubscriptionForBuyer(ctx, shop, other.id)).rejects.toThrow("already cancelled");
    expect(f.mailer.sent.find((m) => m.subject === "Your Glow Lamps subscription is cancelled")?.to).toBe(second.email);

    // Store files carry the setting.
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shopId)));
    expect(file.store.subscribe_and_save).toEqual({ percent_off: 10, active: true });
  });

  it("retries a delivery that's sold out instead of charging", async () => {
    const f = await makeFixture(new DemoModel());
    const ctx: SubscriptionContext = { ...f.ctx, manageUrl: (_, token) => `https://x.example/subscriptions/${token}` };
    await setSubscriptionOffer(f.db, (await f.shop()).id, { percentOff: 5, active: true });
    const order = await f.waitingOrder();
    const sub = await startSubscription(ctx, await f.shop(), { orderRef: order.paymentIntentId!, intervalDays: 14 });
    const [lampVariant] = await f.variants(f.products.lamp.id);
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.id, lampVariant!.id));
    f.advance(15 * DAY);
    expect(await runDueSubscriptions(ctx)).toEqual({ reminded: 0, ordered: 0, failed: 1 });
    const saved = (await f.db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, sub.id) }))!;
    expect(saved).toMatchObject({ status: "active", failures: 1 });
    expect(saved.nextOrderAt.getTime()).toBe(f.ctx.now!().getTime() + 2 * DAY);
    expect(await f.db.query.orders.findMany({ where: eq(schema.orders.subscriptionId, sub.id) })).toHaveLength(0);
  });
});
