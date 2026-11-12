import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, schema } from "@sf/db";
import {
  createShop,
  DEMO_SUPPLIER_LINKS,
  FakePaymentProvider,
  FakeSupplier,
  handlePaymentEvent,
  importProduct,
  LogMailer,
  routeOrder,
  signUp,
  startCheckout,
  supplierMoney,
  suppliersFrom,
} from "../src";

const address = { name: "Ada Buyer", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("supplier money", () => {
  it("says how much to keep with the supplier, and what's stuck because the balance ran out", async () => {
    const db = await createTestDb();
    const payments = new FakePaymentProvider();
    const suppliers = suppliersFrom([new FakeSupplier()]);
    const ctx = { db, payments, suppliers, mailer: new LogMailer(true), orderStatusUrl: () => "https://x/o", now: () => new Date() };
    const user = await signUp(db, { email: "owner@example.com", password: "correct horse" });
    const shop = await createShop(db, user.id, { name: "Glow Lamps", country: "US" });
    expect(await supplierMoney(db, shop.id)).toEqual({ orders: 0, dailyMinor: 0, keepMinor: 0, waiting: { orders: 0, costMinor: 0 } });

    const product = await importProduct(db, suppliers, shop.id, { url: DEMO_SUPPLIER_LINKS[0]!, title: "Lamp", prices: {}, publish: true });
    const variant = (await db.query.variants.findFirst({ where: eq(schema.variants.productId, product.id) }))!;
    const orders = [];
    for (let i = 0; i < 2; i++) {
      const { order } = await startCheckout(db, payments, shop, { email: `b${i}@example.com`, address, lines: [{ variantId: variant.id, quantity: 2 }] });
      const { body, signature } = payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
      await handlePaymentEvent(db, "fake", (await payments.parseWebhook(body, signature))!);
      await routeOrder(ctx, order.id);
      orders.push((await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!);
    }
    const goods = 2 * 2 * variant.costMinor!;
    const shipping = orders.reduce((s, o) => s + o.shippingMinor, 0);
    const daily = Math.round((goods + shipping) / 14);
    expect(await supplierMoney(db, shop.id)).toEqual({ orders: 2, dailyMinor: daily, keepMinor: daily * 7, waiting: { orders: 0, costMinor: 0 } });

    // The supplier refused one for lack of balance: it's waiting, and its goods are added to what to keep.
    await db
      .update(schema.fulfillments)
      .set({ status: "failed", problemCode: "insufficient_balance", problemMessage: "Your CJ wallet balance is too low." })
      .where(eq(schema.fulfillments.orderId, orders[0]!.id));
    expect(await supplierMoney(db, shop.id)).toMatchObject({ keepMinor: daily * 7 + 2 * variant.costMinor!, waiting: { orders: 1, costMinor: 2 * variant.costMinor! } });
  });
});
