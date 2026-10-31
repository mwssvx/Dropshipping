import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, importReviews, moderateReview, notifyReviewReply, productReviews, submitReview } from "../src";
import { makeFixture } from "../evals/fixture";

const STORE = "https://shop.example";

async function setup(autoPublish: boolean) {
  const f = await makeFixture(new DemoModel());
  const shop = { ...(await f.shop()), reviewsAutoPublish: autoPublish };
  const order = await f.shippedOrder();
  const review = await submitReview(f.db, shop, order.paymentIntentId!, { productId: f.products.lamp.id, rating: 4, name: "Ada L.", body: "Lovely light.\nA bit small." });
  const replies = () => f.mailer.sent.filter((m) => m.subject === `${shop.name} replied to your review`);
  return { ...f, shop, order, review, replies, tell: () => notifyReviewReply(f.db, f.mailer, shop, review.id, STORE) };
}

describe("emailing the reviewer the store's reply", () => {
  it("sends the first reply once, with the review and a link to it", async () => {
    const f = await setup(true);
    // No reply yet: nothing to send.
    expect(await f.tell()).toBe(false);
    await moderateReview(f.db, f.shop.id, f.review.id, { reply: "Thanks Ada! A bigger one is coming in May." });
    expect(await f.tell()).toBe(true);
    const [mail] = f.replies();
    expect(mail!.to).toBe(f.order.email);
    expect(mail!.text).toContain("> Lovely light.\n> A bit small.");
    expect(mail!.text).toContain("Thanks Ada! A bigger one is coming in May.");
    expect(mail!.text).toContain(`${STORE}/products/${f.products.lamp.handle}#review-${f.review.id}`);
    // Editing the reply later doesn't email again.
    await moderateReview(f.db, f.shop.id, f.review.id, { reply: "Thanks Ada! Bigger one in June now." });
    expect(await f.tell()).toBe(false);
    expect(f.replies()).toHaveLength(1);
  });

  it("waits until the review is published", async () => {
    const f = await setup(false);
    await moderateReview(f.db, f.shop.id, f.review.id, { reply: "Thank you!" });
    expect(await f.tell()).toBe(false);
    await moderateReview(f.db, f.shop.id, f.review.id, { status: "published" });
    expect(await f.tell()).toBe(true);
    expect(f.replies()).toHaveLength(1);
  });

  it("never emails buyers who unsubscribed, or reviews brought over from another app", async () => {
    const f = await setup(true);
    await f.db.update(schema.customers).set({ unsubscribedAt: new Date() }).where(and(eq(schema.customers.shopId, f.shop.id), eq(schema.customers.email, f.order.email!)));
    await moderateReview(f.db, f.shop.id, f.review.id, { reply: "Thank you!" });
    expect(await f.tell()).toBe(false);

    await importReviews(f.db, f.shop.id, [
      "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
      `${f.products.lamp.handle},published,5,,Ben,ben@example.com,,Great lamp for the bedroom.,,2025-03-01 10:00:00 UTC,`,
    ].join("\n"));
    const imported = (await productReviews(f.db, f.products.lamp.id)).reviews.find((r) => r.name === "Ben")!;
    await moderateReview(f.db, f.shop.id, imported.id, { reply: "Thanks Ben!" });
    expect(await notifyReviewReply(f.db, f.mailer, f.shop, imported.id, STORE)).toBe(false);
    expect(f.replies()).toEqual([]);
  });
});
