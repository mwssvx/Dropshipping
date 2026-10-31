import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, productReviews, rewardReview, reviewRewardStats, setReviewReward, submitReview } from "../src";
import { makeFixture } from "../evals/fixture";

describe("thank-you codes for reviews", () => {
  it("emails a one-time code for a review, once per order, and marks the review", async () => {
    const f = await makeFixture(new DemoModel());
    const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
    const shop = await f.shop();
    const shipped = await f.shippedOrder();
    const review = await submitReview(f.db, { ...shop, reviewsAutoPublish: true }, shipped.paymentIntentId!, { productId: f.products.lamp.id, rating: 2, name: "Ada L.", body: "Dimmer than I hoped, but it works." });

    // Off by default.
    expect(await rewardReview(ctx, review.id)).toBeNull();
    await expect(setReviewReward(f.db, shop.id, 50)).rejects.toThrow("between 5% and 30%");
    await expect(setReviewReward(f.db, shop.id, 4)).rejects.toThrow("between 5% and 30%");
    await setReviewReward(f.db, shop.id, 15);

    // Any review earns it, two stars too.
    const before = f.mailer.sent.length;
    expect(await rewardReview(ctx, review.id)).toBe(15);
    expect(f.mailer.sent.length).toBe(before + 1);
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: shipped.email, subject: "Thanks for your review: 15% off your next order" });
    const code = mail.text.match(/THANKS-[A-Z2-9]{6}/)![0];
    const discount = (await f.db.query.discounts.findFirst({ where: eq(schema.discounts.code, code) }))!;
    expect(discount).toMatchObject({ shopId: shop.id, kind: "percent", value: 15, usageLimit: 1, source: "review", email: shipped.email.toLowerCase() });
    expect(discount.endsAt!.getTime() - Date.now()).toBeGreaterThan(59 * 86_400_000);

    // Once: again, or another review from the same order, sends nothing.
    expect(await rewardReview(ctx, review.id)).toBeNull();
    const [second] = await f.db.insert(schema.reviews).values({ shopId: shop.id, productId: f.products.projector.id, orderId: review.orderId, rating: 5, name: "Ada L.", body: "Love the stars on the ceiling.", status: "published" }).returning();
    expect(await rewardReview(ctx, second!.id)).toBeNull();
    expect(f.mailer.sent.length).toBe(before + 1);
    // Reviews brought over from another platform have no order, so no code.
    const [imported] = await f.db.insert(schema.reviews).values({ shopId: shop.id, productId: f.products.lamp.id, rating: 5, name: "Old Buyer", body: "From the old store.", status: "published" }).returning();
    expect(await rewardReview(ctx, imported!.id)).toBeNull();

    // The store page shows which reviews earned one.
    const shown = await productReviews(f.db, f.products.lamp.id);
    expect(shown.reviews.find((r) => r.id === review.id)!.rewardedAt).not.toBeNull();
    expect(shown.reviews.find((r) => r.id === imported!.id)!.rewardedAt).toBeNull();
    expect(await reviewRewardStats(f.db, shop.id)).toEqual({ sent: 1, used: 0, salesMinor: 0 });
  });
});
