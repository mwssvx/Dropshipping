import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, productReviewSummary, reportReview, reviewPage } from "../src";
import { makeFixture } from "../evals/fixture";

describe("a product's reviews in the admin", () => {
  it("sums up its stars and what needs the merchant, and filters the review list to it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const lamp = f.products.lamp.id;
    const at = (d: number) => new Date(Date.UTC(2025, 0, d));
    const [, , newest] = await f.db
      .insert(schema.reviews)
      .values([
        { shopId: shop.id, productId: lamp, name: "A", rating: 5, body: "Great lamp.", status: "published", reply: "Thanks!", importKey: "1", createdAt: at(1) },
        { shopId: shop.id, productId: lamp, name: "B", rating: 4, body: "Good lamp.", status: "published", importKey: "2", createdAt: at(2) },
        { shopId: shop.id, productId: lamp, name: "C", rating: 2, body: "Too dim.", status: "published", importKey: "3", createdAt: at(3) },
        { shopId: shop.id, productId: lamp, name: "D", rating: 1, body: "Broke.", status: "pending", importKey: "4", createdAt: at(4) },
        { shopId: shop.id, productId: lamp, name: "E", rating: 1, body: "Hidden.", status: "hidden", importKey: "5", createdAt: at(5) },
        { shopId: shop.id, productId: f.products.projector.id, name: "F", rating: 5, body: "Other product.", status: "published", importKey: "6", createdAt: at(6) },
      ])
      .returning();
    await reportReview(f.db, shop.id, newest!.id, "device-bbbbbbbbbbbbbbbb");

    const summary = await productReviewSummary(f.db, shop.id, lamp);
    expect(summary).toMatchObject({ count: 3, average: 3.7, breakdown: [0, 1, 0, 1, 1], waiting: 1, reported: 1, unanswered: 2 });
    expect(summary.latest.map((r) => r.name)).toEqual(["C", "B", "A"]);
    expect(await productReviewSummary(f.db, shop.id, f.products.stand.id)).toMatchObject({ count: 0, average: null, waiting: 0, reported: 0, unanswered: 0 });

    expect((await reviewPage(f.db, shop.id, { productId: lamp })).total).toBe(5);
    expect((await reviewPage(f.db, shop.id, { productId: lamp, status: "published", rating: 2 })).reviews.map((r) => r.review.name)).toEqual(["C"]);
    // Another store's product id finds nothing.
    expect((await reviewPage(f.db, "00000000-0000-0000-0000-000000000000", { productId: lamp })).total).toBe(0);
  });
});
