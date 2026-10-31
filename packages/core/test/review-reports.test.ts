import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, moderateReview, NotFoundError, reportedReviewCount, reportedReviews, reportReview, reviewPage } from "../src";
import { makeFixture } from "../evals/fixture";

const ADA = "ada-device-0000000001";
const BEN = "ben-device-0000000002";

describe("reporting a review", () => {
  it("counts one report per device, lists them for the merchant, and clears when kept or hidden", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [spam, fine, pending] = await f.db
      .insert(schema.reviews)
      .values(
        (["published", "published", "pending"] as const).map((status, i) => ({
          shopId: shop.id,
          productId: f.products.lamp.id,
          name: `Buyer ${i}`,
          rating: 5,
          body: "Visit my site for cheap watches.",
          status,
          importKey: `r${i}`,
        })),
      )
      .returning();
    const countOf = async (id: string) => (await f.db.query.reviews.findFirst({ where: eq(schema.reviews.id, id) }))!.reportCount;

    expect(await reportReview(f.db, shop.id, spam!.id, ADA)).toBe(true);
    // The same device again changes nothing; another device adds one.
    expect(await reportReview(f.db, shop.id, spam!.id, ADA)).toBe(false);
    expect(await reportReview(f.db, shop.id, spam!.id, BEN)).toBe(true);
    expect(await countOf(spam!.id)).toBe(2);
    expect([...(await reportedReviews(f.db, ADA, [spam!.id, fine!.id]))]).toEqual([spam!.id]);
    expect((await reportedReviews(f.db, undefined, [spam!.id])).size).toBe(0);

    // Only published reviews of this store, from a real device id.
    await expect(reportReview(f.db, shop.id, pending!.id, ADA)).rejects.toThrow(NotFoundError);
    await expect(reportReview(f.db, "00000000-0000-0000-0000-000000000000", fine!.id, ADA)).rejects.toThrow(NotFoundError);
    await expect(reportReview(f.db, shop.id, fine!.id, "short")).rejects.toThrow(NotFoundError);
    await expect(reportReview(f.db, shop.id, "not-a-uuid", ADA)).rejects.toThrow(NotFoundError);

    await reportReview(f.db, shop.id, fine!.id, ADA);
    expect(await reportedReviewCount(f.db, shop.id)).toBe(2);
    expect((await reviewPage(f.db, shop.id, { status: "published", reported: true })).reviews.map((r) => r.review.name)).toEqual(
      expect.arrayContaining(["Buyer 0", "Buyer 1"]),
    );

    // Keeping it clears the reports, and that device can't report it again.
    await moderateReview(f.db, shop.id, fine!.id, { clearReports: true });
    expect(await countOf(fine!.id)).toBe(0);
    expect(await reportReview(f.db, shop.id, fine!.id, ADA)).toBe(false);
    expect(await countOf(fine!.id)).toBe(0);
    // Hiding one deals with it too.
    await moderateReview(f.db, shop.id, spam!.id, { status: "hidden" });
    expect(await countOf(spam!.id)).toBe(0);
    expect(await reportedReviewCount(f.db, shop.id)).toBe(0);
  });
});
