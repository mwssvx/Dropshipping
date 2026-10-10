import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  claimReferral,
  DemoModel,
  exportCustomerData,
  handlePaymentEvent,
  myReferrals,
  onOrderPaid,
  referralCodeFor,
  referralCodeForEmail,
  referralStats,
  referrerFor,
  sendReferralRewards,
  setReferralProgram,
  startCheckout,
  syncTracking,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "9 Elm St", city: "Austin", region: "TX", postalCode: "78702", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const [lamp] = await f.variants(f.products.lamp.id);
  const cctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example", now: () => f.ctx.now!() };
  const checkout = async (email: string, discountCode?: string) =>
    startCheckout(f.db, f.payments, await f.shop(), { email, address, lines: [{ variantId: lamp!.id, quantity: 2 }], discountCode });
  const pay = async (email: string, discountCode?: string) => {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines: [{ variantId: lamp!.id, quantity: 2 }], discountCode });
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    await onOrderPaid(f.ctx, order.id);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  };
  return { ...f, shopId, cctx, checkout, pay };
}

const mailFor = (f: { mailer: { sent: { to: string; subject: string; text: string }[] } }, to: string) => f.mailer.sent.filter((m) => m.to === to);

describe("refer a friend", () => {
  it("is off until the merchant turns it on, and checks the terms", async () => {
    const f = await setup();
    const ada = await f.waitingOrder();
    expect(await referralCodeForEmail(f.db, await f.shop(), ada.email)).toBeNull();
    await expect(setReferralProgram(f.db, f.shopId, { friendPercentOff: 60, rewardMinor: 1000 })).rejects.toThrow("5% to 50%");
    await expect(setReferralProgram(f.db, f.shopId, { friendPercentOff: 10, rewardMinor: 50 })).rejects.toThrow("1.00 to 100.00");
    expect(await setReferralProgram(f.db, f.shopId, { friendPercentOff: 10, rewardMinor: 1000 })).toEqual({ friendPercentOff: 10, rewardMinor: 1000, minSubtotalMinor: 0 });
    const code = await referralCodeForEmail(f.db, await f.shop(), ada.email);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    // The same code every time.
    expect(await referralCodeFor(f.db, await f.shop(), ada.customerId!)).toBe(code);
    expect(await referrerFor(f.db, await f.shop(), code!)).toMatchObject({ firstName: "Ada" });
    expect(await referrerFor(f.db, await f.shop(), "NOTACODE")).toBeNull();
  });

  it("emails a friend a first-order code, once, and pays the referrer credit when the order arrives", async () => {
    const f = await setup();
    const ada = await f.waitingOrder();
    await setReferralProgram(f.db, f.shopId, { friendPercentOff: 15, rewardMinor: 1000 });
    const shop = await f.shop();
    const link = (await referralCodeForEmail(f.db, shop, ada.email))!;

    await expect(claimReferral(f.cctx, shop, "ZZZZZZZZ", "grace@example.com")).rejects.toThrow("doesn't work any more");
    await expect(claimReferral(f.cctx, shop, link, "not an email")).rejects.toThrow("valid email");
    expect(await claimReferral(f.cctx, shop, link, " Grace@Example.com ")).toEqual({ sent: true });
    const [mail] = mailFor(f, "grace@example.com");
    expect(mail!.subject).toBe(`Ada gave you 15% off at ${shop.name}`);
    const friendCode = mail!.text.match(/FRIEND-[A-Z2-9]{6}/)![0];

    // No second code for Grace, none for Ada herself, none for someone who has already bought here.
    expect(await claimReferral(f.cctx, shop, link, "grace@example.com")).toEqual({ sent: false });
    expect(await claimReferral(f.cctx, shop, link, ada.email.toUpperCase())).toEqual({ sent: false });
    const other = await f.waitingOrder();
    expect(await claimReferral(f.cctx, shop, link, other.email)).toEqual({ sent: false });
    expect(mailFor(f, "grace@example.com")).toHaveLength(1);
    expect(mailFor(f, other.email).some((m) => m.subject.includes("gave you"))).toBe(false);

    // Only Grace can use it.
    await expect(f.checkout("someone@example.com", friendCode)).rejects.toThrow("different email");
    const order = await f.pay("grace@example.com", friendCode);
    expect(order.discountCode).toBe(friendCode);
    expect(order.discountMinor).toBe(Math.floor(order.subtotalMinor * 0.15));
    expect(order.fulfillmentStatus).toBe("sent_to_supplier");

    // Nothing until it's delivered.
    expect(await sendReferralRewards(f.cctx)).toEqual({ sent: 0 });
    f.advance(DAY + 1);
    await syncTracking(f.ctx, { orderId: order.id });
    expect(await sendReferralRewards(f.cctx)).toEqual({ sent: 0 });
    f.advance(6 * DAY);
    await syncTracking(f.ctx, { orderId: order.id });
    expect((await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!.fulfillmentStatus).toBe("delivered");
    expect(await sendReferralRewards(f.cctx)).toEqual({ sent: 1 });
    expect(await sendReferralRewards(f.cctx)).toEqual({ sent: 0 });
    const credit = mailFor(f, ada.email).filter((m) => m.subject.includes("gift card"));
    expect(credit).toHaveLength(1);
    expect(credit[0]!.subject).toBe(`Your $10.00 gift card for ${shop.name}`);
    expect(credit[0]!.text).toContain("Thanks for sending Grace our way");

    expect(await myReferrals(f.db, f.shopId, ada.customerId!)).toEqual({ invited: 1, rewarded: 1, creditMinor: 1000 });
    expect(await referralStats(f.db, f.shopId)).toMatchObject({ sharers: 1, friends: 1, orders: 1, salesMinor: order.totalMinor, rewarded: 1, creditMinor: 1000 });
    const data = await exportCustomerData(f.db, shop, ada.customerId!);
    expect(data.refer_a_friend).toEqual({ link_code: link, friends_sent_a_code: 1, credit_earned: 1000 });
  });

  it("pays nothing for a refunded order, or once the program is off", async () => {
    const f = await setup();
    const ada = await f.waitingOrder();
    await setReferralProgram(f.db, f.shopId, { friendPercentOff: 10, rewardMinor: 500 });
    const link = (await referralCodeForEmail(f.db, await f.shop(), ada.email))!;
    const codeFor = async (email: string) => {
      await claimReferral(f.cctx, await f.shop(), link, email);
      return mailFor(f, email)[0]!.text.match(/FRIEND-[A-Z2-9]{6}/)![0];
    };
    const one = await f.pay("one@example.com", await codeFor("one@example.com"));
    const two = await f.pay("two@example.com", await codeFor("two@example.com"));
    await f.db.update(schema.orders).set({ paymentStatus: "refunded" }).where(eq(schema.orders.id, one.id));
    f.advance(8 * DAY);
    await syncTracking(f.ctx, { orderId: one.id });
    await syncTracking(f.ctx, { orderId: two.id });
    await setReferralProgram(f.db, f.shopId, null);
    expect(await sendReferralRewards(f.cctx)).toEqual({ sent: 0 });
    // The link stops working too.
    await expect(claimReferral(f.cctx, await f.shop(), link, "three@example.com")).rejects.toThrow("doesn't work any more");
    await setReferralProgram(f.db, f.shopId, { friendPercentOff: 10, rewardMinor: 500 });
    expect(await sendReferralRewards(f.cctx)).toEqual({ sent: 1 });
    expect(await myReferrals(f.db, f.shopId, ada.customerId!)).toEqual({ invited: 2, rewarded: 1, creditMinor: 500 });
  });
});
