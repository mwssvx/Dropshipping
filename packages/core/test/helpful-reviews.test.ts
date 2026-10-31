import { describe, expect, it } from "vitest";
import { DemoModel, helpfulVotes, importReviews, moderateReview, NotFoundError, productReviews, REVIEWS_SHOWN, reviewSort, reviewsQuery, toggleHelpful } from "../src";
import { makeFixture } from "../evals/fixture";

const csv = (n: number) =>
  [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    ...Array.from({ length: n }, (_, i) => `sunset-projection-lamp,published,5,,Buyer ${i},b${i}@example.com,,Review number ${i}.,,2025-03-${String(1 + i).padStart(2, "0")} 10:00:00 UTC,`),
  ].join("\n");
const ada = "device-ada-0123456789";
const ben = "device-ben-0123456789";

describe("helpful reviews", () => {
  it("counts one mark per device, takes it back on a second tap, and sorts by it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await importReviews(f.db, shop.id, csv(3));
    const newest = (await productReviews(f.db, f.products.lamp.id)).reviews;
    expect(newest.map((r) => r.name)).toEqual(["Buyer 2", "Buyer 1", "Buyer 0"]);
    const oldest = newest[2]!;

    expect(await toggleHelpful(f.db, shop.id, oldest.id, ada)).toEqual({ voted: true, count: 1 });
    expect(await toggleHelpful(f.db, shop.id, oldest.id, ben)).toEqual({ voted: true, count: 2 });
    await toggleHelpful(f.db, shop.id, newest[1]!.id, ada);
    // Ben changes his mind.
    expect(await toggleHelpful(f.db, shop.id, oldest.id, ben)).toEqual({ voted: false, count: 1 });
    expect(await toggleHelpful(f.db, shop.id, oldest.id, ben)).toEqual({ voted: true, count: 2 });

    const helpful = (await productReviews(f.db, f.products.lamp.id, REVIEWS_SHOWN, { sort: "helpful" })).reviews;
    expect(helpful.map((r) => [r.name, r.helpfulCount])).toEqual([["Buyer 0", 2], ["Buyer 1", 1], ["Buyer 2", 0]]);
    expect(await helpfulVotes(f.db, ada, newest.map((r) => r.id))).toEqual(new Set([oldest.id, newest[1]!.id]));
    expect(await helpfulVotes(f.db, ben, newest.map((r) => r.id))).toEqual(new Set([oldest.id]));
    expect(await helpfulVotes(f.db, undefined, [oldest.id])).toEqual(new Set());
  });

  it("only takes marks on published reviews of the same store, from a real device id", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await importReviews(f.db, shop.id, csv(1));
    const [review] = (await productReviews(f.db, f.products.lamp.id)).reviews;
    await expect(toggleHelpful(f.db, crypto.randomUUID(), review!.id, ada)).rejects.toBeInstanceOf(NotFoundError);
    await expect(toggleHelpful(f.db, shop.id, review!.id, "short")).rejects.toBeInstanceOf(NotFoundError);
    await expect(toggleHelpful(f.db, shop.id, "not-a-uuid", ada)).rejects.toBeInstanceOf(NotFoundError);
    await moderateReview(f.db, shop.id, review!.id, { status: "hidden" });
    await expect(toggleHelpful(f.db, shop.id, review!.id, ada)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reads the order from a link", () => {
    expect(reviewSort("helpful")).toBe("helpful");
    expect([undefined, "", "newest", "HELPFUL"].map(reviewSort)).toEqual(["newest", "newest", "newest", "newest"]);
    expect(reviewsQuery({})).toBe("");
    expect(reviewsQuery({ stars: 2, sort: "helpful", all: true })).toBe("?stars=2&sort=helpful&reviews=all");
    expect(reviewsQuery({ sort: "newest", all: false })).toBe("");
  });
});
