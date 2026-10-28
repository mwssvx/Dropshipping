import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { collectionMembership, createGiftGuides, DemoModel, deleteCollection, giftGuideTitles } from "../src";
import { makeFixture } from "../evals/fixture";

describe("gift guides", () => {
  it("makes price collections that fill themselves, once each", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect(giftGuideTitles("USD")).toEqual(["Gifts under $25", "Gifts under $50", "Gifts under $100"]);
    expect(giftGuideTitles("EUR")).toEqual(["Gifts under €25", "Gifts under €50", "Gifts under €100"]);

    const made = await createGiftGuides(f.db, shop);
    expect(made.map((c) => c.title)).toEqual(giftGuideTitles("USD"));
    expect(made[0]).toMatchObject({ handle: "gifts-under-25", sortOrder: "best_selling", rules: { match: "all", conditions: [{ kind: "price_at_most", minor: 2500 }, { kind: "in_stock" }] } });
    // Running it again makes nothing; a deleted one comes back.
    expect(await createGiftGuides(f.db, shop)).toEqual([]);
    await deleteCollection(f.db, shop.id, made[1]!.id);
    expect((await createGiftGuides(f.db, shop)).map((c) => c.title)).toEqual(["Gifts under $50"]);

    // The lamp costs under $25 and is in stock, so it's in every guide.
    const [lamp] = await f.db.query.variants.findMany({ where: eq(schema.variants.productId, f.products.lamp.id) });
    expect(lamp!.priceMinor).toBeLessThanOrEqual(2500);
    const members = await collectionMembership(f.db, shop.id, [made[0]!.id]);
    expect(members.get(made[0]!.id)?.has(f.products.lamp.id)).toBe(true);
  });
});
