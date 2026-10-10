import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, eraseCustomer, exportCustomerData, moderateReview, productReviews, reviewPhotoUrl, submitReview } from "../src";
import { makeFixture } from "../evals/fixture";

// The smallest files that pass as each type: the first bytes are what's checked.
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 2)]);
const DAY = 86_400_000;

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shop = { ...(await f.shop()), reviewsAutoPublish: true };
  const order = await f.shippedOrder();
  const review = (photos: Buffer[], body = "Lovely warm light, works great.") =>
    submitReview(f.db, shop, order.paymentIntentId!, { productId: f.products.lamp.id, rating: 5, name: "Ada L.", body }, photos);
  const mediaCount = async () => (await f.db.select().from(schema.media)).length;
  return { ...f, shop, order, review, mediaCount };
}

describe("photo reviews", () => {
  it("takes up to three real photos, and stores nothing when the review is turned down", async () => {
    const f = await setup();
    await expect(f.review([JPG, JPG, JPG, PNG])).rejects.toThrow("Add up to 3 photos.");
    await expect(f.review([Buffer.alloc(3 * 1024 * 1024 + 1, 0xff)])).rejects.toThrow("Each photo can be up to 3 MB.");
    // A text file renamed to .jpg is refused, and the good photo before it is removed again.
    await expect(f.review([JPG, Buffer.from("not really a photo")])).rejects.toThrow("Use a JPG, PNG or WebP photo.");
    await expect(f.review([JPG], "short")).rejects.toThrow("at least 10 characters");
    expect(await f.mediaCount()).toBe(0);

    // Empty file fields (no photo picked) are ignored.
    const review = await f.review([JPG, Buffer.alloc(0), PNG]);
    expect(review.photoIds).toHaveLength(2);
    expect(await f.mediaCount()).toBe(2);
    await expect(f.review([JPG])).rejects.toThrow("already reviewed");
    expect(await f.mediaCount()).toBe(2);
  });

  it("shows the photos on the product page, newest first, and the merchant can take one down", async () => {
    const f = await setup();
    const review = await f.review([JPG, PNG]);
    const page = await productReviews(f.db, f.products.lamp.id);
    expect(page.photos).toEqual(review.photoIds.map((id) => ({ url: reviewPhotoUrl(id), reviewId: review.id, name: "Ada L.", rating: 5 })));
    expect(page.reviews[0]!.photoIds).toEqual(review.photoIds);

    const [first, second] = review.photoIds;
    await moderateReview(f.db, f.shop.id, review.id, { removePhotoId: first });
    expect((await productReviews(f.db, f.products.lamp.id)).photos.map((p) => p.url)).toEqual([reviewPhotoUrl(second!)]);
    expect(await f.db.query.media.findFirst({ where: eq(schema.media.id, first!) })).toBeUndefined();
    // Another store's id, or one not on the review, changes nothing.
    await moderateReview(f.db, f.shop.id, review.id, { removePhotoId: "00000000-0000-0000-0000-000000000000" });
    expect(await f.mediaCount()).toBe(1);

    // Hidden reviews keep their photos off the page.
    await moderateReview(f.db, f.shop.id, review.id, { status: "hidden" });
    expect((await productReviews(f.db, f.products.lamp.id)).photos).toEqual([]);
  });

  it("goes with the buyer's data: in their export, and deleted when they're erased", async () => {
    const f = await setup();
    const review = await f.review([JPG]);
    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, f.order.email) }))!;
    expect((await exportCustomerData(f.db, f.shop, customer.id)).reviews[0]).toMatchObject({ photos: [reviewPhotoUrl(review.photoIds[0]!)] });

    f.advance(DAY + 1);
    await f.db.update(schema.orders).set({ fulfillmentStatus: "delivered" }).where(eq(schema.orders.id, f.order.id));
    await eraseCustomer(f.db, f.shop.id, customer.id, { confirmEmail: f.order.email });
    const after = (await f.db.query.reviews.findFirst({ where: eq(schema.reviews.id, review.id) }))!;
    expect(after).toMatchObject({ name: "Verified buyer", photoIds: [] });
    expect(await f.db.query.media.findMany({ where: inArray(schema.media.id, review.photoIds) })).toEqual([]);
  });
});
