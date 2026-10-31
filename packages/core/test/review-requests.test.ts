import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, reviewRequestStats, sendReviewRequests, setReviewRequestDays, submitReview, syncTracking, unsubscribeBuyer } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

async function delivered(f: Awaited<ReturnType<typeof makeFixture>>) {
  const o = await f.order(f.products.lamp.id);
  f.advance(7 * DAY);
  await syncTracking(f.ctx, { orderId: o.id });
  return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, o.id) }))!;
}

describe("review requests", () => {
  it("asks once, a few days after the order arrives, with a link to the review form", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const order = await delivered(f);
    expect(order.fulfillmentStatus).toBe("delivered");
    const mails = () => f.mailer.sent.filter((m) => m.subject.startsWith("How was"));

    // Not yet: it arrived today, and the store waits 7 days.
    expect(await sendReviewRequests(f.ctx)).toEqual({ sent: 0 });
    f.advance(7 * DAY + 1);
    expect(await sendReviewRequests(f.ctx)).toEqual({ sent: 1 });
    expect(mails()[0]).toMatchObject({ to: order.email, subject: "How was Sunset Projection Lamp?" });
    // One product: five star links, each opening the form with that rating picked.
    expect(mails()[0]!.text).toContain(`★★★★★  https://glow-lamps.example/orders/${order.paymentIntentId}?rate=5#review`);
    expect(mails()[0]!.text).toContain(`★★☆☆☆  https://glow-lamps.example/orders/${order.paymentIntentId}?rate=2#review`);
    expect(mails()[0]!.text).not.toContain("Leave a review:");
    expect(mails()[0]!.text).toContain("Hi Ada,");
    // Once per order.
    expect(await sendReviewRequests(f.ctx)).toEqual({ sent: 0 });

    // A review left after the email counts on the Reviews page.
    await submitReview(f.db, shop, order.paymentIntentId!, { productId: f.products.lamp.id, rating: 5, name: "Ada", body: "Lovely warm light in the evening." });
    expect(await reviewRequestStats(f.db, shop.id, new Date(Date.now() + 15 * DAY))).toEqual({ sent: 1, reviewed: 1 });
  });

  it("skips gifts, unsubscribed buyers, orders already reviewed, old orders and stores that turned it off", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const gift = await delivered(f);
    await f.db.update(schema.orders).set({ gift: { from: "Bo", message: "Happy birthday", recipientEmail: null } }).where(eq(schema.orders.id, gift.id));
    const unsubscribed = await delivered(f);
    await unsubscribeBuyer(f.db, shop.id, unsubscribed.email!);
    const reviewed = await delivered(f);
    await submitReview(f.db, shop, reviewed.paymentIntentId!, { productId: f.products.lamp.id, rating: 4, name: "Bo", body: "Nice, a bit small for the price." });
    f.advance(8 * DAY);
    expect(await sendReviewRequests(f.ctx)).toEqual({ sent: 0 });

    // A store that turned it off; turned back on much later, that order arrived too long ago to ask.
    await expect(setReviewRequestDays(f.db, shop.id, 45)).rejects.toThrow("1 to 30 days");
    await setReviewRequestDays(f.db, shop.id, 0);
    await delivered(f);
    f.advance(8 * DAY);
    expect(await sendReviewRequests(f.ctx)).toEqual({ sent: 0 });
    await setReviewRequestDays(f.db, shop.id, 3);
    f.advance(60 * DAY);
    expect(await sendReviewRequests(f.ctx)).toEqual({ sent: 0 });
    expect(f.mailer.sent.filter((m) => m.subject.startsWith("How was"))).toEqual([]);
  });
});
