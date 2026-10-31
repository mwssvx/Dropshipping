import { describe, expect, it } from "vitest";
import { DemoModel, importReviews, productReviews, REVIEWS_SHOWN, starsFilter } from "../src";
import { makeFixture } from "../evals/fixture";

const row = (i: number, rating: number) => `sunset-projection-lamp,published,${rating},,Buyer ${i},b${i}@example.com,,Review number ${i}.,,2025-03-${String(1 + (i % 28)).padStart(2, "0")} 10:00:00 UTC,`;
const csv = (ratings: number[]) => ["product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at", ...ratings.map((r, i) => row(i, r))].join("\n");

describe("star breakdown on product pages", () => {
  it("counts each rating and lists only the stars asked for", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await importReviews(f.db, shop.id, csv([5, 5, 5, 4, 2]));
    const all = await productReviews(f.db, f.products.lamp.id);
    expect(all).toMatchObject({ count: 5, average: 4.2, breakdown: [0, 1, 0, 1, 3], listedCount: 5 });
    expect(all.reviews).toHaveLength(5);

    const fives = await productReviews(f.db, f.products.lamp.id, REVIEWS_SHOWN, { stars: 5 });
    expect(fives.reviews.map((r) => r.rating)).toEqual([5, 5, 5]);
    // The stars and breakdown still cover every review.
    expect(fives).toMatchObject({ count: 5, average: 4.2, breakdown: [0, 1, 0, 1, 3], listedCount: 3 });
    expect((await productReviews(f.db, f.products.lamp.id, REVIEWS_SHOWN, { stars: 3 })).reviews).toEqual([]);
    expect((await productReviews(f.db, f.products.lamp.id, 2)).reviews).toHaveLength(2);
  });

  it("only takes 1 to 5 from a link", () => {
    expect(starsFilter("4")).toBe(4);
    expect([undefined, "", "0", "6", "4.5", "five"].map((v) => starsFilter(v))).toEqual([null, null, null, null, null, null]);
  });
});
