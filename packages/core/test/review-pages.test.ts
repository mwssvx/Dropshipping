import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, reviewCounts, reviewPage } from "../src";
import { makeFixture } from "../evals/fixture";

describe("review pages", () => {
  it("pages through reviews by status, stars and search, with counts for each tab", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const base = Date.now() - 1000 * 86_400_000;
    const rows = Array.from({ length: 7 }, (_, i) => ({
      shopId: shop.id,
      productId: i < 5 ? f.products.lamp.id : f.products.stand.id,
      name: i === 3 ? "Grace Hopper" : `Buyer ${i}`,
      rating: i % 2 ? 2 : 5,
      body: i === 1 ? "Arrived 100% broken" : "Works well.",
      status: (i === 6 ? "hidden" : i === 5 ? "pending" : "published") as "hidden" | "pending" | "published",
      importKey: `k${i}`,
      createdAt: new Date(base + i * 60_000),
    }));
    await f.db.insert(schema.reviews).values(rows);

    expect(await reviewCounts(f.db, shop.id)).toEqual({ pending: 1, published: 5, hidden: 1 });
    const first = await reviewPage(f.db, shop.id, { status: "published", size: 2 });
    expect(first.total).toBe(5);
    expect(first.reviews.map((r) => r.review.name)).toEqual(["Buyer 4", "Grace Hopper"]);
    expect(first.reviews[0]!.productTitle).toBe(f.products.lamp.title);
    const third = await reviewPage(f.db, shop.id, { status: "published", size: 2, page: 3 });
    expect(third.reviews.map((r) => r.review.name)).toEqual(["Buyer 0"]);

    expect((await reviewPage(f.db, shop.id, { status: "published", rating: 2 })).reviews.map((r) => r.review.name)).toEqual(["Grace Hopper", "Buyer 1"]);
    expect((await reviewPage(f.db, shop.id, { query: "grace" })).reviews.map((r) => r.review.name)).toEqual(["Grace Hopper"]);
    // A % in the search is a plain character, not a wildcard.
    expect((await reviewPage(f.db, shop.id, { query: "100%" })).reviews.map((r) => r.review.name)).toEqual(["Buyer 1"]);
    expect((await reviewPage(f.db, shop.id, { query: f.products.stand.title.toUpperCase() })).total).toBe(2);
    expect((await reviewPage(f.db, shop.id, { query: "nothing like this" })).total).toBe(0);
  });
});
