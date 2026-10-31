import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  abandonedCartStats,
  createDiscount,
  DemoModel,
  exportStore,
  handlePaymentEvent,
  listDiscounts,
  moderateReview,
  productReviews,
  quoteCart,
  reviewableItems,
  sendAbandonedCartEmails,
  setAbandonedCartOffer,
  setGrowthSettings,
  setUpsell,
  spreadDiscount,
  startCheckout,
  submitReview,
  upsellsFor,
  UserError,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const HOUR = 3_600_000;
const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [lamp] = await f.variants(f.products.lamp.id);
  const checkout = async (o: { email?: string; code?: string; quantity?: number } = {}) =>
    startCheckout(f.db, f.payments, await f.shop(), { email: o.email ?? "ada@example.com", address, lines: [{ variantId: lamp!.id, quantity: o.quantity ?? 1 }], discountCode: o.code });
  const pay = async (order: { id: string; paymentIntentId: string | null; totalMinor: number }) => {
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
  };
  return { ...f, lamp: lamp!, checkout, pay };
}

describe("discount codes", () => {
  it("takes a percentage off the subtotal, records it on the order and keeps the totals adding up", async () => {
    const f = await setup();
    const shop = await f.shop();
    await createDiscount(f.db, shop.id, { code: "welcome10", kind: "percent", value: 10 });
    const q = await quoteCart(f.db, shop, [{ variantId: f.lamp.id, quantity: 2 }], { discountCode: " Welcome10 " });
    expect(q.discount?.code).toBe("WELCOME10");
    expect(q.discountMinor).toBe(Math.floor((f.lamp.priceMinor * 2) / 10));
    expect(q.totalMinor).toBe(q.subtotalMinor - q.discountMinor + q.shippingMinor);

    const { order } = await f.checkout({ code: "WELCOME10", quantity: 2 });
    expect(order).toMatchObject({ discountCode: "WELCOME10", discountMinor: q.discountMinor });
    await f.pay(order);
    expect((await listDiscounts(f.db, shop.id))[0]).toMatchObject({ used: 1, discountedMinor: q.discountMinor });
  });

  it("explains why a code can't be used", async () => {
    const f = await setup();
    const shop = await f.shop();
    const now = Date.now();
    await createDiscount(f.db, shop.id, { code: "BIG", kind: "amount", value: 500, minSubtotalMinor: 100_00 });
    await createDiscount(f.db, shop.id, { code: "OLD", kind: "percent", value: 20, endsAt: new Date(now - DAY) });
    await createDiscount(f.db, shop.id, { code: "ONCE", kind: "percent", value: 5, oncePerCustomer: true });
    await createDiscount(f.db, shop.id, { code: "ONE", kind: "percent", value: 5, usageLimit: 1 });
    await expect(f.checkout({ code: "NOPE" })).rejects.toThrow(`"NOPE" isn't a valid code.`);
    await expect(f.checkout({ code: "BIG" })).rejects.toThrow(/works on orders over \$100.00/);
    await expect(f.checkout({ code: "OLD" })).rejects.toThrow("has expired");
    await expect(createDiscount(f.db, shop.id, { code: "big", kind: "percent", value: 5 })).rejects.toThrow("already have a code");
    await expect(createDiscount(f.db, shop.id, { code: "X", kind: "percent", value: 5 })).rejects.toThrow(UserError);
    await expect(createDiscount(f.db, shop.id, { code: "TOOMUCH", kind: "percent", value: 120 })).rejects.toThrow("between 1 and 100");

    await f.pay((await f.checkout({ code: "ONCE" })).order);
    await expect(f.checkout({ code: "ONCE" })).rejects.toThrow("already used ONCE");
    await f.checkout({ code: "ONCE", email: "grace@example.com" });

    // An unpaid checkout doesn't use up a limited code; a paid one does.
    const unpaid = await f.checkout({ code: "ONE" });
    await f.pay((await f.checkout({ code: "ONE", email: "grace@example.com" })).order);
    expect(unpaid.order.discountCode).toBe("ONE");
    await expect(f.checkout({ code: "ONE", email: "linus@example.com" })).rejects.toThrow("used up");
  });

  it("can make shipping free instead", async () => {
    const f = await setup();
    const shop = await f.shop();
    await createDiscount(f.db, shop.id, { code: "SHIPFREE", kind: "free_shipping" });
    const before = await quoteCart(f.db, shop, [{ variantId: f.lamp.id, quantity: 1 }]);
    const after = await quoteCart(f.db, shop, [{ variantId: f.lamp.id, quantity: 1 }], { discountCode: "SHIPFREE" });
    expect(before.shippingMinor).toBeGreaterThan(0);
    expect(after).toMatchObject({ shippingMinor: 0, discountMinor: 0, totalMinor: before.subtotalMinor });
  });

  it("spreads a discount across lines to the cent", () => {
    expect(spreadDiscount([1000, 2000, 3000], 600)).toEqual([900, 1800, 2700]);
    const spread = spreadDiscount([333, 333, 334], 1000);
    expect(spread).toEqual([0, 0, 0]);
    const odd = spreadDiscount([199, 1, 500], 101);
    expect(odd.reduce((s, x) => s + x, 0)).toBe(599);
    expect(odd.every((x) => x >= 0)).toBe(true);
  });
});

describe("abandoned checkout reminders", () => {
  it("sends one reminder an hour later, and counts the checkout as recovered when it's paid", async () => {
    const f = await setup();
    const shop = await f.shop();
    const { order } = await f.checkout();
    const ctx = { ...f.ctx, payUrl: (_: unknown, o: { id: string }) => `https://store.example/pay/${o.id}` };
    expect((await sendAbandonedCartEmails(ctx, new Date(Date.now() + 30 * 60_000))).sent).toBe(0);
    expect((await sendAbandonedCartEmails(ctx, new Date(Date.now() + 2 * HOUR))).sent).toBe(1);
    expect((await sendAbandonedCartEmails(ctx, new Date(Date.now() + 3 * HOUR))).sent).toBe(0);
    const mail = f.mailer.sent.at(-1)!;
    expect(mail.subject).toBe("You left something at Glow Lamps");
    expect(mail.text).toContain(`https://store.example/pay/${order.id}`);

    await f.pay(order);
    expect(await abandonedCartStats(f.db, shop.id, new Date(Date.now() - DAY))).toEqual({ sent: 1, recovered: 1, recoveredMinor: order.totalMinor });
  });

  it("stays quiet if the buyer paid for another order, or the store turned it off", async () => {
    const f = await setup();
    await f.checkout();
    await f.pay((await f.checkout()).order);
    expect((await sendAbandonedCartEmails(f.ctx, new Date(Date.now() + 2 * HOUR))).sent).toBe(0);

    await f.checkout({ email: "grace@example.com" });
    await setGrowthSettings(f.db, (await f.shop()).id, { abandonedCartEmails: false });
    expect((await sendAbandonedCartEmails(f.ctx, new Date(Date.now() + 2 * HOUR))).sent).toBe(0);
  });
});

describe("second checkout reminder with a code", () => {
  it("sends a one-time code for that buyer a day after the first reminder, once", async () => {
    const f = await setup();
    const shop = await f.shop();
    await expect(setAbandonedCartOffer(f.db, shop.id, 70)).rejects.toThrow("between 5% and 50%");
    await setAbandonedCartOffer(f.db, shop.id, 10);
    const { order } = await f.checkout();
    const ctx = { ...f.ctx, payUrl: (_: unknown, o: { id: string }) => `https://store.example/pay/${o.id}` };
    expect(await sendAbandonedCartEmails(ctx, new Date(Date.now() + 2 * HOUR))).toEqual({ sent: 1, offers: 0, browse: 0 });
    // Not before a day has passed since the first one.
    expect((await sendAbandonedCartEmails(ctx, new Date(Date.now() + 12 * HOUR))).offers).toBe(0);
    expect((await sendAbandonedCartEmails(ctx, new Date(Date.now() + 26 * HOUR))).offers).toBe(1);
    expect((await sendAbandonedCartEmails(ctx, new Date(Date.now() + 30 * HOUR))).offers).toBe(0);

    const mail = f.mailer.sent.at(-1)!;
    expect(mail.subject).toBe("10% off what you left at Glow Lamps");
    const code = mail.text.match(/BACK-[A-Z2-9]{6}/)![0];
    expect(mail.text).toContain(`https://store.example/pay/${order.id}/cart?code=${code}`);
    expect(mail.text).toContain("Sunset Projection Lamp – Small × 1");

    // Only for that buyer's email, and once.
    await expect(f.checkout({ email: "grace@example.com", code })).rejects.toThrow();
    const { order: back } = await f.checkout({ code });
    expect(Math.abs(back.discountMinor - back.subtotalMinor * 0.1)).toBeLessThanOrEqual(1);
    await f.pay(back);
    await expect(f.checkout({ code })).rejects.toThrow();
    // It stays off the codes list, and the reminder stats count the sale.
    expect((await listDiscounts(f.db, shop.id)).some((d) => d.code === code)).toBe(false);
    expect(await abandonedCartStats(f.db, shop.id, new Date(Date.now() - DAY))).toMatchObject({ sent: 2, recovered: 1, recoveredMinor: back.totalMinor });
  });

  it("isn't sent when the store has it off, or the buyer paid in the meantime", async () => {
    const f = await setup();
    const shop = await f.shop();
    await f.checkout();
    expect((await sendAbandonedCartEmails(f.ctx, new Date(Date.now() + 2 * HOUR))).sent).toBe(1);
    expect((await sendAbandonedCartEmails(f.ctx, new Date(Date.now() + 26 * HOUR))).offers).toBe(0);

    await setAbandonedCartOffer(f.db, shop.id, 15);
    await f.pay((await f.checkout()).order);
    expect((await sendAbandonedCartEmails(f.ctx, new Date(Date.now() + 26 * HOUR))).offers).toBe(0);
    // The setting travels in the store file.
    expect((await exportStore(f.db, shop.id)).store.abandoned_cart_offer).toEqual({ percent_off: 15 });
    await setAbandonedCartOffer(f.db, shop.id, null);
    expect((await f.shop()).abandonedCartOffer).toBeNull();
  });
});

describe("reviews", () => {
  it("lets a buyer review once the order has shipped, and shows it after the merchant publishes it", async () => {
    const f = await setup();
    const shop = await f.shop();
    const waiting = await f.waitingOrder();
    expect(await reviewableItems(f.db, shop.id, waiting.paymentIntentId!)).toEqual([]);

    const shipped = await f.shippedOrder();
    const [item] = await reviewableItems(f.db, shop.id, shipped.paymentIntentId!);
    expect(item).toMatchObject({ productId: f.products.lamp.id, review: null });
    await expect(submitReview(f.db, shop, shipped.paymentIntentId!, { productId: f.products.lamp.id, rating: 6, name: "Ada", body: "Lovely warm light." })).rejects.toThrow("1 to 5");
    const review = await submitReview(f.db, shop, shipped.paymentIntentId!, { productId: f.products.lamp.id, rating: 4, name: "Ada", body: "Lovely warm light, a bit small." });
    expect(review.status).toBe("pending");
    await expect(submitReview(f.db, shop, shipped.paymentIntentId!, { productId: f.products.lamp.id, rating: 5, name: "Ada", body: "Trying again for 5 stars." })).rejects.toThrow("already reviewed");
    await expect(submitReview(f.db, shop, shipped.paymentIntentId!, { productId: f.products.stand.id, rating: 5, name: "Ada", body: "Never bought this one." })).rejects.toThrow("once your order has shipped");

    expect((await productReviews(f.db, f.products.lamp.id)).count).toBe(0);
    await moderateReview(f.db, shop.id, review.id, { status: "published", reply: "Thanks, Ada!" });
    expect(await productReviews(f.db, f.products.lamp.id)).toMatchObject({ count: 1, average: 4 });
  });

  it("publishes straight away when the store says so", async () => {
    const f = await setup();
    await setGrowthSettings(f.db, (await f.shop()).id, { reviewsAutoPublish: true });
    const shop = await f.shop();
    const shipped = await f.shippedOrder();
    const r = await submitReview(f.db, shop, shipped.paymentIntentId!, { productId: f.products.lamp.id, rating: 5, name: "Ada", body: "Perfect for the bedroom." });
    expect(r.status).toBe("published");
  });
});

describe("goes well with", () => {
  it("suggests a product that's on sale and not already in the cart", async () => {
    const f = await setup();
    const shop = await f.shop();
    await expect(setUpsell(f.db, shop.id, f.products.lamp.id, f.products.lamp.id)).rejects.toThrow("different product");
    await setUpsell(f.db, shop.id, f.products.lamp.id, f.products.projector.id);
    await setUpsell(f.db, shop.id, f.products.projector.id, f.products.stand.id); // stand is a draft
    expect((await upsellsFor(f.db, shop.id, [f.products.lamp.id])).map((u) => u.id)).toEqual([f.products.projector.id]);
    expect(await upsellsFor(f.db, shop.id, [f.products.lamp.id, f.products.projector.id])).toEqual([]);
    await f.db.update(schema.products).set({ status: "archived" }).where(eq(schema.products.id, f.products.projector.id));
    expect(await upsellsFor(f.db, shop.id, [f.products.lamp.id])).toEqual([]);
  });
});
