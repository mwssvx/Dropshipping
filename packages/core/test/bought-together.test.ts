import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { boughtTogether, DemoModel, handlePaymentEvent, startCheckout } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("often bought together", () => {
  it("suggests what buyers bought in the same paid orders, most often first", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const { lamp, stand, projector } = f.products;
    await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, stand.id));
    const first = async (productId: string) => (await f.variants(productId))[0]!.id;
    const checkout = async (productIds: string[], pay = true) => {
      const { order } = await startCheckout(f.db, f.payments, await f.shop(), {
        email: "grace@example.com",
        address,
        lines: await Promise.all(productIds.map(async (id) => ({ variantId: await first(id), quantity: 1 }))),
      });
      if (!pay) return;
      const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
      await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    };

    expect(await boughtTogether(f.db, shopId, [lamp.id])).toEqual([]);
    for (let i = 0; i < 3; i++) await checkout([lamp.id, stand.id]);
    await checkout([lamp.id, projector.id]);
    // Unpaid checkouts don't count.
    await checkout([lamp.id, projector.id], false);
    expect((await boughtTogether(f.db, shopId, [lamp.id])).map((p) => [p.title, p.orders])).toEqual([[stand.title, 3]]);

    // A second paid order with the projector makes it count, after the stand.
    await checkout([lamp.id, projector.id]);
    expect((await boughtTogether(f.db, shopId, [lamp.id])).map((p) => p.id)).toEqual([stand.id, projector.id]);
    // It works both ways, and never suggests what's asked about.
    expect((await boughtTogether(f.db, shopId, [projector.id])).map((p) => p.id)).toEqual([lamp.id]);
    expect(await boughtTogether(f.db, shopId, [lamp.id, stand.id, projector.id])).toEqual([]);

    // Hidden products and sold-out ones are left out.
    await f.db.update(schema.products).set({ status: "draft" }).where(eq(schema.products.id, stand.id));
    for (const v of await f.variants(projector.id)) await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.id, v.id));
    expect(await boughtTogether(f.db, shopId, [lamp.id])).toEqual([]);
  });
});
