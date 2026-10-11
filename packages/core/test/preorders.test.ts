import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  DemoModel,
  exportStore,
  handlePaymentEvent,
  notifyLatePreorders,
  onOrderPaid,
  orderDelivery,
  preordersSold,
  quoteCart,
  routeStuckOrders,
  setPreorder,
  startCheckout,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const ymd = (d: Date) => d.toISOString().slice(0, 10);

describe("pre-orders", () => {
  it("checks the terms", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const id = f.products.lamp.id;
    const now = new Date();
    await expect(setPreorder(f.db, shopId, id, { shipsBy: ymd(now), limit: null })).rejects.toThrow("from tomorrow on");
    await expect(setPreorder(f.db, shopId, id, { shipsBy: ymd(new Date(now.getTime() + 200 * DAY)), limit: null })).rejects.toThrow("up to 120 days");
    await expect(setPreorder(f.db, shopId, id, { shipsBy: "next week", limit: null })).rejects.toThrow("Pick the date");
    await expect(setPreorder(f.db, shopId, id, { shipsBy: ymd(new Date(now.getTime() + 10 * DAY)), limit: 0 })).rejects.toThrow("at least 1");
    const shipsBy = ymd(new Date(now.getTime() + 10 * DAY));
    expect(await setPreorder(f.db, shopId, id, { shipsBy, limit: 5 })).toEqual({ shipsBy, limit: 5 });
    expect(await setPreorder(f.db, shopId, id, null)).toBeNull();
  });

  it("sells sold-out options up to the limit, holds the order until stock is back, and flags it when late", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const [small, large] = await f.variants(f.products.lamp.id);
    const notify = { db: f.db, mailer: f.mailer, adminUrl: (p: string) => `https://app.example${p}` };
    const setStock = (id: string, stock: number) => f.db.update(schema.variants).set({ stock }).where(eq(schema.variants.id, id));
    const fulfillments = async (orderId: string) => (await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, orderId) })).length;
    const buy = async (lines: { variantId: string; quantity: number }[]) => {
      const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "grace@example.com", address, lines });
      const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
      await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
      await onOrderPaid(f.ctx, order.id);
      return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    };

    await setStock(small!.id, 0);
    await setStock(large!.id, 10);
    // Sold out, and no pre-orders yet.
    await expect(quoteCart(f.db, await f.shop(), [{ variantId: small!.id, quantity: 1 }])).rejects.toThrow("sold out");

    const shipsBy = ymd(new Date(Date.now() + 14 * DAY));
    await setPreorder(f.db, shopId, f.products.lamp.id, { shipsBy, limit: 2 });
    const quote = await quoteCart(f.db, await f.shop(), [
      { variantId: small!.id, quantity: 1 },
      { variantId: large!.id, quantity: 1 },
    ]);
    // Only the sold-out option is a pre-order.
    expect(quote.items.map((i) => i.preorderShipsBy)).toEqual([shipsBy, null]);
    await expect(quoteCart(f.db, await f.shop(), [{ variantId: small!.id, quantity: 3 }])).rejects.toThrow("Only 2 of Sunset Projection Lamp left to pre-order.");

    const order = await buy([
      { variantId: small!.id, quantity: 1 },
      { variantId: large!.id, quantity: 1 },
    ]);
    expect(order.preorderShipsBy?.toISOString()).toBe(`${shipsBy}T23:59:59.999Z`);
    const lines = await f.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    expect(lines.map((l) => [l.variantId, l.preorder])).toEqual(expect.arrayContaining([[small!.id, true], [large!.id, false]]));
    expect(await preordersSold(f.db, f.products.lamp.id)).toBe(1);
    // Not sent to the supplier yet, and the receipt says when it ships.
    expect(await fulfillments(order.id)).toBe(0);
    const receipt = f.mailer.sent.find((m) => m.subject === `Order #${order.number} confirmed`)!;
    expect(receipt.text).toContain("Pre-order: it ships by");
    // Delivery is counted from the ship-by date.
    const delivery = (await orderDelivery(f.db, await f.shop(), order))!;
    expect(delivery.from.getTime()).toBeGreaterThan(new Date(`${shipsBy}T00:00:00Z`).getTime());

    // The daily job leaves it alone while it's sold out.
    f.advance(DAY);
    expect(await routeStuckOrders(f.ctx)).toEqual({ routed: 0 });

    // One more fits under the limit, then it's full.
    await buy([{ variantId: small!.id, quantity: 1 }]);
    await expect(quoteCart(f.db, await f.shop(), [{ variantId: small!.id, quantity: 1 }])).rejects.toThrow("Pre-orders for Sunset Projection Lamp are full.");

    // Back in stock: both go to the supplier on the next run.
    await setStock(small!.id, 20);
    f.advance(DAY);
    expect(await routeStuckOrders(f.ctx)).toEqual({ routed: 2 });
    expect(await fulfillments(order.id)).toBeGreaterThan(0);

    // Another pre-order whose stock never comes back: the team hears once, after the date.
    await setStock(large!.id, 0);
    await setPreorder(f.db, shopId, f.products.lamp.id, { shipsBy, limit: null });
    const late = await buy([{ variantId: large!.id, quantity: 1 }]);
    expect(await notifyLatePreorders(notify, { now: new Date() })).toEqual({ sent: 0 });
    const after = new Date(Date.now() + 15 * DAY);
    expect(await notifyLatePreorders(notify, { now: after })).toEqual({ sent: 1 });
    expect(f.mailer.sent.at(-1)).toMatchObject({ to: "owner@example.com", subject: `Pre-order #${late.number} at Glow Lamps is past its ship-by date` });
    expect(f.mailer.sent.at(-1)!.text).toContain(`Sunset Projection Lamp – ${large!.title}`);
    expect(await notifyLatePreorders(notify, { now: after })).toEqual({ sent: 0 });

    // Store files carry it.
    const file = await exportStore(f.db, shopId);
    expect(file.products.find((p) => p.handle === f.products.lamp.handle)!.preorder).toEqual({ ships_by: shipsBy, limit: null });
  });
});
