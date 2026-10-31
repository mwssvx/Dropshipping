import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { doorKey, createProduct, DemoModel, ordersToSameAddress, startCheckout } from "../src";
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

    const found = await ordersToSameAddress(f.db, shop.id, first);
    expect(found.ownItems).toBe(true);
    expect(found.orders.map((o) => [o.number, o.ownItems])).toEqual([[second.number, true], [lampOnly.number, false]]);

    // Once the store has posted its own parcel for the second order, it can't share a box any more.
    await f.db.insert(schema.fulfillments).values({ shopId: shop.id, orderId: second.id, supplierId: null, status: "shipped", carrier: "USPS", trackingNumber: "9400111", shippedAt: new Date() });
    expect((await ordersToSameAddress(f.db, shop.id, first)).orders.map((o) => o.ownItems)).toEqual([false, false]);

    // Pickups aren't posted.
    expect(await ordersToSameAddress(f.db, shop.id, { ...first, pickup: true })).toEqual({ orders: [], ownItems: false });
  });
});
