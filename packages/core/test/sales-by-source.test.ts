import { describe, expect, it } from "vitest";
import { analyticsReport, DemoModel, handlePaymentEvent, recordEvent, refundOrder, startCheckout, utmSourceOf, visitSource } from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const visit = (n: number) => `visit-${String(n).padStart(4, "0")}`;

describe("sales by source", () => {
  it("each order keeps where its visit came from, and Analytics adds up sales by it", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const [lamp] = await f.variants(f.products.lamp.id);
    // Visit 1 came from Instagram, visit 2 from a tagged newsletter link, visit 3 typed the address.
    await recordEvent(f.db, shop.id, { sessionId: visit(1), kind: "page_view", referrer: "https://l.instagram.com/?u=x", host: "glow.example" });
    await recordEvent(f.db, shop.id, { sessionId: visit(1), kind: "product_view", productId: f.products.lamp.id, referrer: "https://glow.example/", host: "glow.example" });
    await recordEvent(f.db, shop.id, { sessionId: visit(2), kind: "page_view", utmSource: " Spring Newsletter! ", referrer: "https://mail.example/" });
    await recordEvent(f.db, shop.id, { sessionId: visit(3), kind: "page_view" });
    expect(await visitSource(f.db, shop.id, visit(1))).toBe("instagram.com");
    expect(await visitSource(f.db, shop.id, visit(2))).toBe("spring-newsletter");
    expect(await visitSource(f.db, shop.id, visit(3))).toBeNull();
    expect(await visitSource(f.db, shop.id, "bad id")).toBeNull();
    expect(utmSourceOf("  ")).toBeNull();

    const buy = async (session: string, quantity = 1) => {
      const { order } = await startCheckout(f.db, f.payments, shop, {
        email: `${session}@example.com`,
        address,
        lines: [{ variantId: lamp!.id, quantity }],
        visitSource: await visitSource(f.db, shop.id, session),
      });
      const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
      await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
      return order;
    };
    const insta = await buy(visit(1), 2);
    const insta2 = await buy(visit(1));
    const news = await buy(visit(2));
    const direct = await buy(visit(3));
    expect([insta.visitSource, news.visitSource, direct.visitSource]).toEqual(["instagram.com", "spring-newsletter", null]);
    // An unpaid checkout isn't a sale.
    await startCheckout(f.db, f.payments, shop, { email: "x@example.com", address, lines: [{ variantId: lamp!.id, quantity: 5 }], visitSource: "tiktok.com" });
    // Refunds come off.
    await refundOrder(f.ctx, shop.id, news.id, {});

    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const r = await analyticsReport(f.db, shop.id, { from: new Date(today - 6 * DAY), to: new Date(today + DAY) });
    expect(r.salesBySource).toEqual([
      { source: "instagram.com", orders: 2, salesMinor: insta.totalMinor + insta2.totalMinor },
      { source: "Direct", orders: 1, salesMinor: direct.totalMinor },
      { source: "spring-newsletter", orders: 1, salesMinor: 0 },
    ]);
  });
});
