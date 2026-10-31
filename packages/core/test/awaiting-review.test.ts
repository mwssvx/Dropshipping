import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { awaitingReview, DemoModel, submitReview } from "../src";
import { makeFixture } from "../evals/fixture";

describe("waiting for your review", () => {
  it("lists shipped, unreviewed products per order, and drops them once reviewed", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const shipped = await f.shippedOrder();
    const waiting = await f.waitingOrder();
    const refunded = await f.shippedOrder();
    await f.db.update(schema.orders).set({ paymentStatus: "refunded" }).where(eq(schema.orders.id, refunded.id));
    const ids = [shipped.id, waiting.id, refunded.id];

    const before = await awaitingReview(f.db, shop.id, ids);
    // Not yet shipped and refunded orders aren't asked about.
    expect([...before.keys()]).toEqual([shipped.id]);
    expect(before.get(shipped.id)).toEqual([{ productId: f.products.lamp.id, title: "Sunset Projection Lamp" }]);
    // Another store's id finds nothing.
    expect((await awaitingReview(f.db, "00000000-0000-0000-0000-000000000000", ids)).size).toBe(0);
    expect((await awaitingReview(f.db, shop.id, [])).size).toBe(0);

    await submitReview(f.db, shop, shipped.paymentIntentId!, { productId: f.products.lamp.id, rating: 5, name: "Ada L.", body: "Lovely warm light, works great." });
    expect((await awaitingReview(f.db, shop.id, ids)).size).toBe(0);
  });
});
