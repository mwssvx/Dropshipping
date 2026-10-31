import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createGiftCardProduct, createProduct, DemoModel, getOrder, orderParcels, quoteCart, startCheckout } from "../src";
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
});
