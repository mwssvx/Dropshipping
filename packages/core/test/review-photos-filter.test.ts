import { describe, expect, it } from "vitest";
import { DemoModel, productReviews, REVIEWS_SHOWN, reviewsQuery, submitReview } from "../src";
import { makeFixture } from "../evals/fixture";

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);

describe("reviews with photos", () => {
  it("lists only reviews with buyer photos and counts them", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = { ...(await f.shop()), reviewsAutoPublish: true };
    const write = async (rating: number, photos: Buffer[]) => {
      const order = await f.shippedOrder();
      return submitReview(f.db, shop, order.paymentIntentId!, { productId: f.products.lamp.id, rating, name: `Buyer ${rating}`, body: "Works well and looks great." }, photos);
    };
    const plain = await write(5, []);
    const pictured = await write(4, [JPG]);
    await write(2, [JPG, JPG]);

    const all = await productReviews(f.db, f.products.lamp.id);
    expect(all).toMatchObject({ count: 3, listedCount: 3, withPhotosCount: 2 });
    const photos = await productReviews(f.db, f.products.lamp.id, REVIEWS_SHOWN, { photos: true });
    expect(photos.reviews.map((r) => r.rating).sort()).toEqual([2, 4]);
    expect(photos.reviews.map((r) => r.id)).not.toContain(plain.id);
    // The stars and breakdown still cover every review.
    expect(photos).toMatchObject({ count: 3, breakdown: [0, 1, 0, 1, 1], listedCount: 2, withPhotosCount: 2 });
    const fourWithPhotos = await productReviews(f.db, f.products.lamp.id, REVIEWS_SHOWN, { photos: true, stars: 4 });
    expect(fourWithPhotos.reviews.map((r) => r.id)).toEqual([pictured.id]);
    expect(fourWithPhotos.listedCount).toBe(1);
    expect((await productReviews(f.db, f.products.lamp.id, REVIEWS_SHOWN, { photos: true, stars: 5 })).listedCount).toBe(0);

    expect(reviewsQuery({ stars: 4, photos: true, sort: "helpful", all: true })).toBe("?stars=4&photos=1&sort=helpful&reviews=all");
  });
});
