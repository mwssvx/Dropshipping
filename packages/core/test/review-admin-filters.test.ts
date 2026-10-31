import { describe, expect, it } from "vitest";
import { schema } from "@sf/db";
import { DemoModel, moderateReview, reviewPage } from "../src";
import { makeFixture } from "../evals/fixture";

describe("review filters for the merchant", () => {
  it("lists reviews with no reply yet, or with photos, together with stars and search", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const base = Date.now() - 100 * 86_400_000;
    const photo = "00000000-0000-0000-0000-000000000001";
    const rows = await f.db
      .insert(schema.reviews)
      .values(
        ["Ada", "Grace", "Linus", "Margaret"].map((name, i) => ({
          shopId: shop.id,
          productId: f.products.lamp.id,
          name,
          rating: i < 2 ? 5 : 2,
          body: "Works well enough.",
          status: "published" as const,
          reply: i === 0 ? "Thank you!" : null,
          photoIds: i % 2 ? [photo] : [],
          importKey: `f${i}`,
          createdAt: new Date(base + i * 60_000),
        })),
      )
      .returning();
    const names = async (opts: Parameters<typeof reviewPage>[2]) => (await reviewPage(f.db, shop.id, { status: "published", ...opts })).reviews.map((r) => r.review.name);

    expect(await names({ noReply: true })).toEqual(["Margaret", "Linus", "Grace"]);
    expect(await names({ photos: true })).toEqual(["Margaret", "Grace"]);
    expect(await names({ noReply: true, photos: true, rating: 2 })).toEqual(["Margaret"]);
    expect((await reviewPage(f.db, shop.id, { noReply: true, query: "linus" })).total).toBe(1);

    // Replying takes a review off the list; clearing the reply puts it back.
    const linus = rows.find((r) => r.name === "Linus")!;
    await moderateReview(f.db, shop.id, linus.id, { reply: "Sorry to hear that, we've sent a new one." });
    expect(await names({ noReply: true })).toEqual(["Margaret", "Grace"]);
    await moderateReview(f.db, shop.id, linus.id, { reply: "   " });
    expect(await names({ noReply: true })).toEqual(["Margaret", "Linus", "Grace"]);
  });
});
