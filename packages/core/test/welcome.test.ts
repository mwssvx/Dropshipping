import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  confirmNewsletterSignup, confirmSignup, createShop, DemoModel, eraseCustomer, exportCustomerData, exportStore, handlePaymentEvent, importStore, listDiscounts, quoteCart,
  requestNewsletterSignup, sendWelcomeCode, setWelcomeOffer, signUp, startCheckout, welcomeOfferStats,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const shopId = (await f.shop()).id;
  const [small] = await f.variants(f.products.lamp.id);
  const cctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example", now: () => f.ctx.now!() };
  /** Signs up on the home page and clicks the confirm link, like a shopper would. */
  const subscribe = async (email: string) => {
    await requestNewsletterSignup(cctx, await f.shop(), email);
    const c = await f.db.query.customers.findFirst({ where: eq(schema.customers.email, email.toLowerCase()) });
    return (await confirmSignup(cctx, await f.shop(), c!.emailToken))!.welcome;
  };
  const pay = async (email: string, discountCode?: string) => {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines: [{ variantId: small!.id, quantity: 2 }], discountCode });
    const { body, signature } = f.payments.event({ id: `evt_${order.id}`, type: "payment.succeeded", paymentIntentId: order.paymentIntentId!, amountMinor: order.totalMinor });
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    return order;
  };
  return { ...f, shopId, small: small!, cctx, subscribe, pay };
}

describe("welcome offer", () => {
  it("is off until the merchant sets it, and checks the terms", async () => {
    const f = await setup();
    expect(await f.subscribe("ada@example.com")).toBeNull();
    await expect(setWelcomeOffer(f.db, f.shopId, { percentOff: 60, days: 30 })).rejects.toThrow("5% to 50%");
    await expect(setWelcomeOffer(f.db, f.shopId, { percentOff: 10, days: 3 })).rejects.toThrow("7 to 90 days");
    expect(await setWelcomeOffer(f.db, f.shopId, { percentOff: 10, minSubtotalMinor: 3000, days: 14 })).toEqual({ percentOff: 10, minSubtotalMinor: 3000, days: 14 });
    // Ada confirmed before it was on, so clicking her link again doesn't send one now.
    const ada = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "ada@example.com") }))!;
    expect(await confirmSignup(f.cctx, await f.shop(), ada.emailToken)).toEqual({ email: "ada@example.com", welcome: null });
    expect(await confirmSignup(f.cctx, await f.shop(), "f".repeat(64))).toBeNull();
    await setWelcomeOffer(f.db, f.shopId, null);
    expect((await f.shop()).welcomeOffer).toBeNull();
  });

  it("emails each new subscriber one personal code that works once, for them, until it expires", async () => {
    const f = await setup();
    await setWelcomeOffer(f.db, f.shopId, { percentOff: 10, minSubtotalMinor: 0, days: 14 });
    const sent = await f.subscribe("Grace@Example.com");
    expect(sent!.code).toMatch(/^WELCOME-[A-HJ-NP-Z2-9]{6}$/);
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "grace@example.com", subject: "Your 10% off code for Glow Lamps" });
    expect(mail.text).toContain(sent!.code);
    expect(mail.text).toContain("It works once, with this email address.");
    // Confirming again, or calling it twice, sends nothing more.
    expect(await sendWelcomeCode(f.cctx, await f.shop(), "grace@example.com")).toBeNull();
    expect(await f.subscribe("grace@example.com")).toBeNull();
    // It isn't on the merchant's list of codes.
    expect(await listDiscounts(f.db, f.shopId)).toEqual([]);

    // In the cart, before the email is known, it applies; at checkout it's only for Grace.
    const q = await quoteCart(f.db, await f.shop(), [{ variantId: f.small.id, quantity: 2 }], { discountCode: sent!.code });
    expect(q.discountMinor).toBe(Math.floor((f.small.priceMinor * 2 * 10) / 100));
    await expect(f.pay("someone@example.com", sent!.code)).rejects.toThrow("sent to a different email address");
    const order = await f.pay("grace@example.com", sent!.code.toLowerCase());
    expect(order.discountMinor).toBe(q.discountMinor);
    await expect(f.pay("grace@example.com", sent!.code)).rejects.toThrow(/used up|already used/);
    expect(await welcomeOfferStats(f.db, f.shopId)).toEqual({ sent: 1, used: 1, salesMinor: order.totalMinor });

    // Checkout runs on the real clock, so send Lin's code as if it were 15 days ago.
    await requestNewsletterSignup(f.cctx, await f.shop(), "lin@example.com");
    const lin = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "lin@example.com") }))!;
    await confirmNewsletterSignup(f.db, f.shopId, lin.emailToken);
    const other = await sendWelcomeCode({ ...f.cctx, now: () => new Date(Date.now() - 15 * DAY) }, await f.shop(), "lin@example.com");
    await expect(f.pay("lin@example.com", other!.code)).rejects.toThrow("expired");
  });

  it("skips buyers who have already ordered", async () => {
    const f = await setup();
    await f.pay("ada@example.com");
    await setWelcomeOffer(f.db, f.shopId, { percentOff: 15, days: 30 });
    expect(await f.subscribe("ada@example.com")).toBeNull();
    expect(f.mailer.sent.some((m) => m.subject.includes("off code"))).toBe(false);
  });

  it("travels with the store file, and goes with the buyer's data", async () => {
    const f = await setup();
    await setWelcomeOffer(f.db, f.shopId, { percentOff: 20, minSubtotalMinor: 5000, days: 30 });
    const { code } = (await f.subscribe("grace@example.com"))!;

    const file = JSON.parse(JSON.stringify(await exportStore(f.db, f.shopId)));
    expect(file.store.welcome_offer).toEqual({ percent_off: 20, min_subtotal: 5000, days: 30 });
    expect(file.discount_codes).toEqual([]);
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    expect((await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!.welcomeOffer).toEqual({ percentOff: 20, minSubtotalMinor: 5000, days: 30 });

    const customer = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "grace@example.com") }))!;
    const data = await exportCustomerData(f.db, await f.shop(), customer.id);
    expect(data.welcome_codes).toEqual([expect.objectContaining({ code, percent_off: 20 })]);
    await eraseCustomer(f.db, f.shopId, customer.id, { confirmEmail: "grace@example.com" });
    const d = (await f.db.query.discounts.findFirst({ where: eq(schema.discounts.code, code) }))!;
    expect(d).toMatchObject({ active: false, email: expect.stringMatching(/@erased\.invalid$/) });
  });
});
