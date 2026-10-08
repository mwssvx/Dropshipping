import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  amountToCharge, createDiscount, createGiftCardProduct, DemoModel, exportStore, findGiftCard, handlePaymentEvent, issueGiftCard, listGiftCards,
  normalizeGiftCardCode, onOrderPaid, quoteCart, refundOrder, resendGiftCard, setGiftCardDisabled, setProductSupplier, startCheckout, addOwnSupplier,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const codesIn = (text: string) => [...text.matchAll(/Gift card code: (\S+)/g)].map((m) => m[1]!);

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [lamp] = await f.variants(f.products.lamp.id);
  const gc = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
  async function pay(order: { id: string; paymentIntentId: string | null; totalMinor: number; giftCardMinor: number; presentment: null | { totalMinor: number } }) {
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: amountToCharge(order as never) });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  }
  const balance = async (id: string) => (await f.db.query.giftCards.findFirst({ where: eq(schema.giftCards.id, id) }))!.balanceMinor;
  return { ...f, lamp: lamp!, gc, pay, balance };
}

describe("gift cards", () => {
  it("codes are 16 characters in groups of four, and typing them loosely still works", () => {
    expect(normalizeGiftCardCode("abcd efgh-jkmn pqrs")).toBe("ABCDEFGHJKMNPQRS");
    expect(normalizeGiftCardCode("SUMMER10")).toBeNull();
  });

  it("a buyer buys gift cards on the store and gets the codes by email; no discount, shipping or tax on them", async () => {
    const f = await setup();
    const shop = await f.shop();
    const product = await createGiftCardProduct(f.db, shop, [5000, 2500, 5000]);
    await expect(createGiftCardProduct(f.db, shop, [1000])).rejects.toThrow("already sell gift cards");
    const variants = await f.variants(product.id);
    expect(variants.map((v) => [v.title, v.priceMinor])).toEqual([["$25.00", 2500], ["$50.00", 5000]]);
    const own = await addOwnSupplier(f.db, shop.id, { name: "Woodworks", email: "orders@wood.example" });
    await expect(setProductSupplier(f.db, shop.id, product.id, own.id)).rejects.toThrow("don't need a supplier");

    await createDiscount(f.db, shop.id, { code: "TENOFF", kind: "percent", value: 10 });
    const lines = [{ variantId: variants[1]!.id, quantity: 2 }, { variantId: f.lamp.id, quantity: 1 }];
    const q = await quoteCart(f.db, shop, lines, { discountCode: "TENOFF" });
    expect(q.discountMinor).toBe(Math.floor(f.lamp.priceMinor * 0.1)); // only the lamp
    const onlyCards = await quoteCart(f.db, shop, [{ variantId: variants[1]!.id, quantity: 2 }]);
    expect(onlyCards).toMatchObject({ shippingMinor: 0, totalMinor: 10_000 });

    const { order } = await startCheckout(f.db, f.payments, shop, { email: "giver@example.com", address, lines: [{ variantId: variants[1]!.id, quantity: 2 }] });
    expect(order).toMatchObject({ taxMinor: 0, totalMinor: 10_000, platformFeeMinor: 200 }); // 2% on the free plan, taken when sold
    const paid = await f.pay(order);
    expect(paid.fulfillmentStatus).toBe("delivered");
    const mails = f.mailer.sent.filter((m) => m.to === "giver@example.com" && m.subject.includes("gift card"));
    expect(mails).toHaveLength(2);
    const codes = mails.flatMap((m) => codesIn(m.text));
    expect(codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(codes[0]).not.toBe(codes[1]);
    // Running it again doesn't issue more.
    await onOrderPaid(f.ctx, order.id);
    const { cards, outstandingMinor } = await listGiftCards(f.db, shop.id);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ orderNumber: order.number, initialMinor: 5000, email: "giver@example.com", last4: codes[1]!.slice(-4) });
    expect(outstandingMinor).toBe(10_000);
    // The database never has the code itself.
    const row = await f.db.query.giftCards.findFirst();
    expect(JSON.stringify(row)).not.toContain(normalizeGiftCardCode(codes[0]!));

    // A full refund turns the cards off.
    await refundOrder(f.ctx, shop.id, order.id, {});
    await expect(findGiftCard(f.db, shop, codes[0]!)).rejects.toThrow("turned off");
  });

  it("a gift card pays for all of an order, and what's left stays on it", async () => {
    const f = await setup();
    const shop = await f.shop();
    const { card } = await issueGiftCard(f.gc, shop, { email: "Friend@Example.com", amountMinor: 50_00, note: "Sorry about the broken lamp" });
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "friend@example.com", subject: "Your $50.00 gift card for Glow Lamps" });
    expect(mail.text).toContain("Sorry about the broken lamp");
    const code = codesIn(mail.text)[0]!;

    const lines = [{ variantId: f.lamp.id, quantity: 1 }];
    const q = await quoteCart(f.db, shop, lines, { giftCardCode: code.toLowerCase() });
    expect(q.giftCard).toMatchObject({ last4: card.last4, appliedMinor: q.totalMinor });
    expect(q.dueMinor).toBe(0);

    const { order, paidWithGiftCard } = await startCheckout(f.db, f.payments, shop, { email: "friend@example.com", address, lines, giftCardCode: code });
    expect(paidWithGiftCard).toBe(true);
    expect(order).toMatchObject({ paymentStatus: "paid", giftCardId: card.id, giftCardMinor: order.totalMinor, platformFeeMinor: 0, processingFeeMinor: 0 });
    expect(order.paymentIntentId).toMatch(/^giftcard_/);
    expect(await f.balance(card.id)).toBe(50_00 - order.totalMinor);
    await onOrderPaid(f.ctx, order.id);
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.fulfillmentStatus).toBe("sent_to_supplier");

    // Refunded straight back onto the gift card: there was no card payment.
    await refundOrder(f.ctx, shop.id, order.id, {});
    expect(await f.balance(card.id)).toBe(50_00);
  });

  it("a gift card pays for part of an order, the card pays the rest, and refunds go to the card first", async () => {
    const f = await setup();
    const shop = await f.shop();
    const { card } = await issueGiftCard(f.gc, shop, { email: "ada@example.com", amountMinor: 500 });
    const code = codesIn(f.mailer.sent.at(-1)!.text)[0]!;
    const lines = [{ variantId: f.lamp.id, quantity: 1 }];
    const { order, paidWithGiftCard } = await startCheckout(f.db, f.payments, shop, { email: "ada@example.com", address, lines, giftCardCode: code });
    expect(paidWithGiftCard).toBe(false);
    expect(order).toMatchObject({ giftCardMinor: 500, paymentStatus: "pending" });
    expect(amountToCharge(order)).toBe(order.totalMinor - 500);
    expect(order.platformFeeMinor).toBe(Math.round(((order.totalMinor - order.taxMinor - 500) * 200) / 10_000));
    // Not spent until the rest is paid.
    expect(await f.balance(card.id)).toBe(500);
    // A payment for the full total is refused: only the rest is charged.
    const wrong = f.payments.event({ id: "evt_wrong", type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await expect(handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(wrong.body, wrong.signature))!)).rejects.toThrow("Amount mismatch");
    await f.pay(order);
    expect(await f.balance(card.id)).toBe(0);
    await expect(quoteCart(f.db, shop, lines, { giftCardCode: code })).rejects.toThrow("used up");

    const cardPart = order.totalMinor - 500;
    await refundOrder(f.ctx, shop.id, order.id, { amountMinor: cardPart - 100 });
    expect(await f.balance(card.id)).toBe(0);
    const last = await refundOrder(f.ctx, shop.id, order.id, {});
    expect(last.refund).toMatchObject({ amountMinor: 600, giftCardMinor: 500 });
    expect(await f.balance(card.id)).toBe(500);
  });

  it("wrong, turned-off and replaced codes are refused, and gift cards can't buy gift cards", async () => {
    const f = await setup();
    const shop = await f.shop();
    const lines = [{ variantId: f.lamp.id, quantity: 1 }];
    await expect(quoteCart(f.db, shop, lines, { giftCardCode: "AAAA-BBBB-CCCC-DDDD" })).rejects.toThrow("isn't right");
    await expect(issueGiftCard(f.gc, shop, { email: "x@example.com", amountMinor: 50 })).rejects.toThrow("start at 1.00");
    const { card } = await issueGiftCard(f.gc, shop, { email: "x@example.com", amountMinor: 2000 });
    const code = codesIn(f.mailer.sent.at(-1)!.text)[0]!;

    await setGiftCardDisabled(f.db, shop.id, card.id, true);
    await expect(quoteCart(f.db, shop, lines, { giftCardCode: code })).rejects.toThrow("turned off");
    await expect(resendGiftCard(f.gc, shop, card.id)).rejects.toThrow("back on");
    await setGiftCardDisabled(f.db, shop.id, card.id, false);

    await resendGiftCard(f.gc, shop, card.id);
    const fresh = codesIn(f.mailer.sent.at(-1)!.text)[0]!;
    expect(f.mailer.sent.at(-1)!.text).toContain("old code no longer works");
    await expect(quoteCart(f.db, shop, lines, { giftCardCode: code })).rejects.toThrow("isn't right");
    expect((await quoteCart(f.db, shop, lines, { giftCardCode: fresh })).giftCard?.balanceMinor).toBe(2000);

    const product = await createGiftCardProduct(f.db, shop, [2500]);
    const [v] = await f.variants(product.id);
    await expect(quoteCart(f.db, shop, [...lines, { variantId: v!.id, quantity: 1 }], { giftCardCode: fresh })).rejects.toThrow("can't be bought with a gift card");
    // Another store's code doesn't work here.
    await expect(setGiftCardDisabled(f.db, "00000000-0000-0000-0000-000000000000", card.id, true)).rejects.toThrow("not found");
    // Gift cards are in the store's currency only.
    await expect(
      startCheckout(f.db, f.payments, shop, { email: "x@example.com", address, lines, giftCardCode: fresh, fx: { currency: "EUR", rate: 0.9 } as never }),
    ).rejects.toThrow("Gift cards are in USD");
    expect((await exportStore(f.db, shop.id)).products.find((p) => p.title === "Gift card")).toMatchObject({ gift_card: true });
  });
});
