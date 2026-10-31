import { describe, expect, it } from "vitest";
import { createPost, DemoModel, handlePaymentEvent, postStats, recordEvent, refundOrder, startCheckout, visitPost } from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const body = "A long enough post about lamps, with plenty of words to read before bed tonight.";
const visit = (n: number) => `visit-${String(n).padStart(4, "0")}`;

describe("blog reads and sales", () => {
  it("counts the visits that read each post, and the sales of visits whose last post it was", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    const guide = await createPost(f.db, shop.id, { title: "Picking a lamp", body }, { published: true });
    const news = await createPost(f.db, shop.id, { title: "Our new lamp", body }, { published: true });
    const read = (n: number, postId: string) => recordEvent(f.db, shop.id, { sessionId: visit(n), kind: "post_view", postId });

    // A read needs a post of this store.
    expect(await recordEvent(f.db, shop.id, { sessionId: visit(9), kind: "post_view" })).toBe(false);
    expect(await recordEvent(f.db, shop.id, { sessionId: visit(9), kind: "post_view", postId: "00000000-0000-4000-8000-000000000000" })).toBe(false);

    // Visit 1 reads the guide twice, then the news; visit 2 reads only the guide; visit 3 reads nothing.
    expect(await read(1, guide.id)).toBe(true);
    await read(1, guide.id);
    await new Promise((r) => setTimeout(r, 5));
    await read(1, news.id);
    await read(2, guide.id);
    expect(await visitPost(f.db, shop.id, visit(1))).toBe(news.id);
    expect(await visitPost(f.db, shop.id, visit(2))).toBe(guide.id);
    expect(await visitPost(f.db, shop.id, visit(3))).toBeNull();
    expect(await visitPost(f.db, shop.id, "bad id")).toBeNull();

    const buy = async (session: string, quantity = 1, pay = true) => {
      const { order } = await startCheckout(f.db, f.payments, shop, {
        email: `${session}@example.com`,
        address,
        lines: [{ variantId: lamp!.id, quantity }],
        visitPostId: await visitPost(f.db, shop.id, session),
      });
      if (pay) {
        const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
        await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
      }
      return order;
    };
    const fromNews = await buy(visit(1), 2);
    const fromGuide = await buy(visit(2));
    const refunded = await buy(visit(2));
    await buy(visit(2), 3, false);
    await buy(visit(3));
    expect([fromNews.visitPostId, fromGuide.visitPostId]).toEqual([news.id, guide.id]);
    await refundOrder(f.ctx, shop.id, refunded.id, {});

    const stats = await postStats(f.db, shop.id, [guide.id, news.id]);
    expect(stats.get(guide.id)).toEqual({ reads: 2, orders: 2, salesMinor: fromGuide.totalMinor });
    expect(stats.get(news.id)).toEqual({ reads: 1, orders: 1, salesMinor: fromNews.totalMinor });
    // Only the last 30 days count.
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect((await postStats(f.db, shop.id, [guide.id], 30, later)).get(guide.id)).toEqual({ reads: 0, orders: 0, salesMinor: 0 });
    expect((await postStats(f.db, shop.id, [])).size).toBe(0);
  });
});
