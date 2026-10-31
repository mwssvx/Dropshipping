import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { addManualTracking, addTrackingToSameBox, doorKey, createProduct, DemoModel, ordersToSameAddress, packingSlips, sameAddressOnList, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("orders to the same address", () => {
  it("treats spacing, case and dots as the same door", () => {
    expect(doorKey({ ...address, line1: "1 main st.", postalCode: "78 701" })).toBe(doorKey(address));
    expect(doorKey({ ...address, line2: "Apt 2" })).not.toBe(doorKey(address));
  });

  it("lists the buyer's other paid orders there that haven't shipped, and which share a box", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    const own = await createProduct(f.db, shop.id, { title: "Handmade Coaster", status: "active", variants: [{ priceMinor: 900, stock: 20 }] });
    const [coaster] = await f.variants(own.id);
    const place = async (lines: { variantId: string; quantity: number }[], to = address, paid = true) => {
      const { order } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address: to, lines, storefront: true });
      if (paid) await f.db.update(schema.orders).set({ paymentStatus: "paid", paidAt: new Date() }).where(eq(schema.orders.id, order.id));
      return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
    };
    const first = await place([{ variantId: coaster!.id, quantity: 1 }]);
    const second = await place([{ variantId: lamp!.id, quantity: 1 }, { variantId: coaster!.id, quantity: 1 }], { ...address, line1: "1 main st." });
    const lampOnly = await place([{ variantId: lamp!.id, quantity: 1 }]);
    await place([{ variantId: coaster!.id, quantity: 1 }], { ...address, line1: "9 Oak Ave" });
    await place([{ variantId: coaster!.id, quantity: 1 }], address, false);
    const shipped = await place([{ variantId: coaster!.id, quantity: 1 }]);
    await f.db.update(schema.orders).set({ fulfillmentStatus: "shipped" }).where(eq(schema.orders.id, shipped.id));
    const old = await place([{ variantId: coaster!.id, quantity: 1 }]);
    await f.db.update(schema.orders).set({ createdAt: new Date(first.createdAt.getTime() - 40 * 86_400_000) }).where(eq(schema.orders.id, old.id));

    // The order list marks each one with the others going there.
    const page = await f.db.query.orders.findMany({ where: eq(schema.orders.shopId, shop.id) });
    const marks = await sameAddressOnList(f.db, shop.id, page);
    expect(marks.get(first.id)?.map((x) => x.number)).toEqual([second.number, lampOnly.number]);
    expect(marks.get(second.id)?.map((x) => x.number)).toEqual([first.number, lampOnly.number]);
    expect([marks.has(shipped.id), marks.has(old.id), marks.size]).toEqual([false, false, 3]);

    const found = await ordersToSameAddress(f.db, shop.id, first);
    expect(found.ownItems).toBe(true);
    expect(found.orders.map((o) => [o.number, o.ownItems])).toEqual([[second.number, true], [lampOnly.number, false]]);

    // The packing slips say which orders share a box: only those with the store's own items.
    const { slips } = await packingSlips(f.db, shop.id, { orderIds: [first.id, second.id, lampOnly.id] });
    expect(slips.map((x) => [x.number, x.sameBox])).toEqual([[first.number, [second.number]], [second.number, [first.number]], [lampOnly.number, []]]);

    // Posted in one box: the first order's tracking goes on the second too, never on one without own items.
    const tracking = { carrier: "USPS", trackingNumber: "9400111" };
    await addManualTracking(f.ctx, shop.id, first.id, tracking);
    expect(await addTrackingToSameBox(f.ctx, shop.id, first.id, [second.id, lampOnly.id, shipped.id], tracking)).toEqual([second.number]);
    const posted = await f.db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, second.id) });
    expect(posted.filter((x) => x.supplierId === null).map((x) => x.trackingNumber)).toEqual(["9400111"]);
    // With nothing of its own left to post (no supplier order was placed here), the second one reads shipped.
    expect((await ordersToSameAddress(f.db, shop.id, first)).orders.map((o) => [o.number, o.ownItems])).toEqual([[lampOnly.number, false]]);

    // Pickups aren't posted.
    expect(await ordersToSameAddress(f.db, shop.id, { ...first, pickup: true })).toEqual({ orders: [], ownItems: false });
  });
});
