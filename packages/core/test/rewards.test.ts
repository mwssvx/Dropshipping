import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  adjustPoints, amountToCharge, creditFor, DemoModel, describeRewards, earnPoints, findGiftCard, handlePaymentEvent, onOrderPaid, pointsFor, quoteCart, redeemPoints, refundOrder,
  rewardsFor, rewardsSummary, setRewardsSettings, startCheckout,
} from "../src";
import { makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup(rewards = true) {
  const f = await makeFixture(new DemoModel());
  if (rewards) await setRewardsSettings(f.db, (await f.shop()).id, { enabled: true, earnRate: 5, valueMinor: 100 });
  const [small] = await f.variants(f.products.lamp.id);
  /** A paid order for ada, as the store's webhook and paid handler would make it. */
  async function paidOrder(quantity: number, opts: { giftCardCode?: string } = {}) {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email: "ada@example.com", address, lines: [{ variantId: small!.id, quantity }], ...opts });
    if (order.paymentStatus !== "paid") {
      const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: amountToCharge(order) });
      await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    }
    await onOrderPaid(f.ctx, order.id);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  }
  const gctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example" };
  return { ...f, small: small!, paidOrder, gctx };
}

describe("rewards", () => {
  it("checks the settings and explains them in plain words", async () => {
    const f = await setup(false);
    const shop = await f.shop();
    await expect(setRewardsSettings(f.db, shop.id, { enabled: true, earnRate: 0, valueMinor: 100 })).rejects.toThrow("at least 1 point");
    await expect(setRewardsSettings(f.db, shop.id, { enabled: true, earnRate: 1, valueMinor: 20_000 })).rejects.toThrow("up to 100.00");
    expect(describeRewards(shop)).toBe("1 point per $1.00 spent. 100 points = $1.00 off.");
    expect(pointsFor({ ...shop, rewardsEarnRate: 5 }, 1399)).toBe(69);
    expect(creditFor(shop, 250)).toBe(200);
    // Turned off, orders earn nothing.
    const order = await f.paidOrder(1);
    expect(await earnPoints(f.db, order.id)).toBe(0);
    expect((await rewardsFor(f.db, shop, "ada@example.com")).points).toBe(0);
  });

  it("earns points once per paid order and takes them back on refunds", async () => {
    const f = await setup();
    const order = await f.paidOrder(3);
    const shop = await f.shop();
    const goods = order.subtotalMinor - order.discountMinor;
    const earned = pointsFor(shop, goods);
    expect(earned).toBeGreaterThan(0);
    expect((await rewardsFor(f.db, shop, "Ada@Example.com ")).points).toBe(earned);
    // Running the paid handler again doesn't add more.
    expect(await earnPoints(f.db, order.id)).toBe(0);

    const half = Math.floor(order.totalMinor / 2);
    await refundOrder(f.ctx, shop.id, order.id, { amountMinor: half });
    const afterPart = (await rewardsFor(f.db, shop, "ada@example.com")).points;
    expect(afterPart).toBe(earned - Math.round((earned * half) / order.totalMinor));
    await refundOrder(f.ctx, shop.id, order.id, {});
    const after = await rewardsFor(f.db, shop, "ada@example.com");
    expect(after.points).toBe(0);
    expect(after.entries.map((e) => e.label)).toEqual([`Refund #${order.number}`, `Refund #${order.number}`, `Order #${order.number}`]);
  });

  it("swaps points for store credit that pays in the cart, and never spends them twice", async () => {
    const f = await setup();
    const shop = await f.shop();
    await f.paidOrder(3);
    const customer = (await f.db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, "ada@example.com")) }))!;
    await adjustPoints(f.db, shop.id, customer.id, { points: 500, note: "Sorry about the late parcel" });
    await expect(adjustPoints(f.db, shop.id, customer.id, { points: 10, note: " " })).rejects.toThrow("short note");
    const before = await rewardsFor(f.db, shop, "ada@example.com");
    expect(before.entries[0]!.label).toBe("Sorry about the late parcel");

    await expect(redeemPoints(f.gctx, shop, "ada@example.com", 150)).rejects.toThrow("hundreds");
    await expect(redeemPoints(f.gctx, shop, "ada@example.com", 1_000_000)).rejects.toThrow(`You have ${before.points.toLocaleString("en-US")} points.`);
    await expect(redeemPoints(f.gctx, shop, "nobody@example.com", 100)).rejects.toThrow("any points");

    // Two presses at once: only what the balance covers goes through.
    const spend = Math.floor(before.points / 100) * 100;
    const results = await Promise.allSettled([redeemPoints(f.gctx, shop, "ada@example.com", spend), redeemPoints(f.gctx, shop, "ada@example.com", spend)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { code, creditMinor } = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof redeemPoints>>>).value;
    expect(creditMinor).toBe(creditFor(shop, spend));
    expect((await rewardsFor(f.db, shop, "ada@example.com")).points).toBe(before.points - spend);
    expect(f.mailer.sent.at(-1)!.text).toContain(code);

    // The credit is a gift card: it pays in the cart, and paying with it earns no points.
    expect((await findGiftCard(f.db, shop, code)).balanceMinor).toBe(creditMinor);
    const cart = await quoteCart(f.db, shop, [{ variantId: f.small.id, quantity: 1 }], { giftCardCode: code });
    expect(cart.giftCard!.appliedMinor).toBe(Math.min(creditMinor, cart.totalMinor));
    const order = await f.paidOrder(1, { giftCardCode: code });
    const earned = (await f.db.query.rewardEntries.findFirst({ where: and(eq(schema.rewardEntries.orderId, order.id), eq(schema.rewardEntries.kind, "order")) }))?.points ?? 0;
    expect(earned).toBe(pointsFor(shop, Math.max(0, order.subtotalMinor - order.discountMinor - order.giftCardMinor)));

    const summary = await rewardsSummary(f.db, shop);
    expect(summary).toMatchObject({ members: 1, redeemedPoints: spend });
    expect(summary.top[0]!.email).toBe("ada@example.com");
  });
});
