import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  amountToCharge, createGiftCardProduct, DemoModel, findGiftCard, giftCardBalance, giftCardBonusNow, handlePaymentEvent, onOrderPaid, refundOrder, setGiftCardBonus, startCheckout,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };
const codeIn = (text: string) => /Gift card code: (\S+)/.exec(text)?.[1] ?? null;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describe("gift card bonus", () => {
  it("gives the buyer a bonus card for every step of gift cards bought while the offer is on", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const product = await createGiftCardProduct(f.db, shop, [2500, 5000]);
    const [small, big] = await f.variants(product.id);
    async function buy(email: string, lines: { variantId: string; quantity: number }[]) {
      const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines });
      const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: amountToCharge(order) });
      await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
      await onOrderPaid(f.ctx, order.id);
      return order;
    }

    const offer = { everyMinor: 5000, bonusMinor: 1000, from: day(-1), to: day(5), usableFrom: day(30), usableUntil: day(60) };
    await expect(setGiftCardBonus(f.db, shop.id, { ...offer, bonusMinor: 6000 })).rejects.toThrow("at most what the buyer spends");
    await expect(setGiftCardBonus(f.db, shop.id, { ...offer, to: day(-2) })).rejects.toThrow("can't be before its first");
    await expect(setGiftCardBonus(f.db, shop.id, { ...offer, usableUntil: day(3) })).rejects.toThrow("stay usable after the offer's last day");
    await setGiftCardBonus(f.db, shop.id, offer);
    expect(giftCardBonusNow(await f.shop())).toMatchObject({ everyMinor: 5000, bonusMinor: 1000 });
    expect(giftCardBonusNow(await f.shop(), new Date(Date.now() + 7 * DAY))).toBeNull();

    // $125 in gift cards is two steps of $50: a $20 bonus card, for the buyer.
    const order = await buy("giver@example.com", [{ variantId: big!.id, quantity: 2 }, { variantId: small!.id, quantity: 1 }]);
    const mail = f.mailer.sent.find((m) => m.subject === "Your $20.00 bonus card for Glow Lamps")!;
    expect(mail.to).toBe("giver@example.com");
    expect(mail.text).toContain(`Thanks for buying gift cards on order #${order.number}.`);
    expect(mail.text).toMatch(/You can use it from \w+ \d+, \d{4} until \w+ \d+, \d{4}/);
    const bonus = await f.db.query.giftCards.findFirst({ where: and(eq(schema.giftCards.sourceOrderId, order.id), eq(schema.giftCards.bonus, true)) });
    expect(bonus).toMatchObject({ initialMinor: 2000, sourceIndex: -1, usableFrom: new Date(`${day(30)}T00:00:00Z`), expiresAt: new Date(`${day(61)}T00:00:00Z`) });
    // The three bought cards are as usual.
    expect(await f.db.query.giftCards.findMany({ where: and(eq(schema.giftCards.sourceOrderId, order.id), eq(schema.giftCards.bonus, false)) })).toHaveLength(3);

    // Held back until its first day, then good until its last.
    const code = codeIn(mail.text)!;
    await expect(findGiftCard(f.db, await f.shop(), code)).rejects.toThrow("can be used from");
    expect((await findGiftCard(f.db, await f.shop(), code, new Date(`${day(30)}T01:00:00Z`))).id).toBe(bonus!.id);
    await expect(findGiftCard(f.db, await f.shop(), code, new Date(`${day(61)}T00:00:00Z`))).rejects.toThrow("expired on");
    expect(await giftCardBalance(f.db, shop.id, code)).toMatchObject({ balanceMinor: 2000, usableFrom: bonus!.usableFrom, expiresAt: bonus!.expiresAt });

    // Only once per order, and nothing under the first step.
    await onOrderPaid(f.ctx, order.id);
    expect(f.mailer.sent.filter((m) => m.subject.includes("bonus card"))).toHaveLength(1);
    await buy("small@example.com", [{ variantId: small!.id, quantity: 1 }]);
    expect(f.mailer.sent.filter((m) => m.subject.includes("bonus card"))).toHaveLength(1);

    // Refunding the order turns the bonus card off with the rest.
    await refundOrder(f.ctx, shop.id, order.id, {});
    await expect(findGiftCard(f.db, await f.shop(), code, new Date(`${day(30)}T01:00:00Z`))).rejects.toThrow("turned off");

    // Ended: no more bonus cards.
    await setGiftCardBonus(f.db, shop.id, null);
    await buy("late@example.com", [{ variantId: big!.id, quantity: 1 }]);
    expect(f.mailer.sent.filter((m) => m.subject.includes("bonus card"))).toHaveLength(1);
  });
});
