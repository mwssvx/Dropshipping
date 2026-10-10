import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { addRecentId, createGiftCardProduct, DemoModel, MAX_RECENT, recentIdsFrom, recentlyViewed } from "../src";
import { makeFixture } from "../evals/fixture";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("recently viewed", () => {
  it("keeps the cookie tidy: ids only, newest first, no repeats, at most twelve", () => {
    expect(recentIdsFrom("nope")).toEqual([]);
    expect(recentIdsFrom([uuid(1), "<script>", 4, uuid(1), uuid(2)])).toEqual([uuid(1), uuid(2)]);
    const many = Array.from({ length: 20 }, (_, i) => uuid(i));
    expect(recentIdsFrom(many)).toHaveLength(MAX_RECENT);
    expect(addRecentId([uuid(1), uuid(2), uuid(3)], uuid(3))).toEqual([uuid(3), uuid(1), uuid(2)]);
  });

  it("lists products still on sale in the order they were viewed, leaving out what's asked", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const { lamp, stand, projector } = f.products;
    const card = await createGiftCardProduct(f.db, shop, [2500]);
    // The stand starts as a draft, which never shows; publish it.
    expect((await recentlyViewed(f.db, shop.id, [stand.id])).length).toBe(0);
    await f.db.update(schema.products).set({ status: "active" }).where(eq(schema.products.id, stand.id));
    const ids = [projector.id, card.id, stand.id, lamp.id, uuid(9)];
    expect((await recentlyViewed(f.db, shop.id, ids)).map((p) => p.title)).toEqual([projector.title, stand.title, lamp.title]);
    expect((await recentlyViewed(f.db, shop.id, ids, { exclude: [stand.id], limit: 1 })).map((p) => p.id)).toEqual([projector.id]);

    // Archived products drop out; sold-out ones stay, marked.
    await f.db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, projector.id));
    await f.db.update(schema.variants).set({ stock: 0 }).where(eq(schema.variants.productId, stand.id));
    const list = await recentlyViewed(f.db, shop.id, ids);
    expect(list.map((p) => [p.id, p.soldOut])).toEqual([[stand.id, true], [lamp.id, false]]);
    // Another store's products never show.
    expect(await recentlyViewed(f.db, uuid(5), ids)).toEqual([]);
  });
});
