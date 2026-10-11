import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  DemoModel,
  exportStore,
  handlePaymentEvent,
  listDiscounts,
  quoteCart,
  sendWinbackEmails,
  setWinbackOffer,
  startCheckout,
  unsubscribeBuyer,
  winbackDueCount,
  winbackStats,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Grace Hopper", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

describe("win-back emails", () => {
  it("checks the terms", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    await expect(setWinbackOffer(f.db, shopId, { afterDays: 45, percentOff: 10, days: 14 })).rejects.toThrow("30, 60, 90 or 180 days");
    await expect(setWinbackOffer(f.db, shopId, { afterDays: 60, percentOff: 60, days: 14 })).rejects.toThrow("5% to 50%");
    await expect(setWinbackOffer(f.db, shopId, { afterDays: 60, percentOff: 10, days: 90 })).rejects.toThrow("7 to 60 days");
    expect(await setWinbackOffer(f.db, shopId, { afterDays: 60, percentOff: 15, days: 14 })).toEqual({ afterDays: 60, percentOff: 15, days: 14 });
    await setWinbackOffer(f.db, shopId, null);
    expect((await f.shop()).winbackOffer).toBeNull();
  });

  it("emails subscribers who haven't ordered in a while, once per lapse", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    const [small] = await f.variants(f.products.lamp.id);
    const now = () => f.ctx.now!();
    const cctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example", now };
    const pay = async (email: string, o: { consent?: boolean; code?: string; daysAgo?: number } = {}) => {
      const { order } = await startCheckout(f.db, f.payments, await f.shop(), {
        email,
        address,
        lines: [{ variantId: small!.id, quantity: 1 }],
        acceptsMarketing: o.consent ?? true,
        discountCode: o.code,
      });
      const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
      await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
      // Payments are stamped with the real time; line them up with the test clock.
      await f.db.update(schema.orders).set({ paidAt: new Date(now().getTime() - (o.daysAgo ?? 0) * DAY) }).where(eq(schema.orders.id, order.id));
      return order;
    };

    await pay("ada@example.com");
    await pay("bob@example.com", { consent: false });
    await pay("cy@example.com");
    await unsubscribeBuyer(f.db, shopId, "cy@example.com");
    // Last bought 300 days ago: too long ago to email out of the blue.
    await pay("dee@example.com", { daysAgo: 300 });

    // Off until the merchant turns it on.
    f.advance(61 * DAY);
    expect(await sendWinbackEmails(cctx)).toEqual({ sent: 0 });
    const offer = (await setWinbackOffer(f.db, shopId, { afterDays: 60, percentOff: 15, days: 14 }))!;
    expect(await winbackDueCount(f.db, { id: shopId }, offer, now())).toBe(1);

    expect(await sendWinbackEmails(cctx)).toEqual({ sent: 1 });
    const mail = f.mailer.sent.at(-1)!;
    expect(mail).toMatchObject({ to: "ada@example.com", subject: "We miss you at Glow Lamps: 15% off your next order" });
    const code = mail.text.match(/BACK-[A-HJ-NP-Z2-9]{6}/)![0];
    expect(mail.text).toContain("Type it in your cart before");
    const ada = (await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "ada@example.com") }))!;
    expect(mail.text).toContain(`Unsubscribe: https://glow.example/unsubscribe/${ada.emailToken}`);
    expect(mail.headers?.["List-Unsubscribe"]).toBe(`<https://glow.example/unsubscribe/${ada.emailToken}/one-click>`);
    expect(await sendWinbackEmails(cctx)).toEqual({ sent: 0 });
    expect(await winbackDueCount(f.db, { id: shopId }, offer, now())).toBe(0);
    // Not on the merchant's list of codes, and only Ada's to use.
    expect(await listDiscounts(f.db, shopId)).toEqual([]);
    await expect(quoteCart(f.db, await f.shop(), [{ variantId: small!.id, quantity: 1 }], { discountCode: code, email: "bob@example.com" })).rejects.toThrow();

    // Ada comes back with it the next day.
    f.advance(DAY);
    await pay("ada@example.com", { code });
    expect(await winbackStats(f.db, shopId)).toMatchObject({ sent: 1, used: 1 });
    expect((await winbackStats(f.db, shopId)).salesMinor).toBeGreaterThan(0);

    // Two months after that order, she's due again.
    f.advance(30 * DAY);
    expect(await sendWinbackEmails(cctx)).toEqual({ sent: 0 });
    f.advance(31 * DAY);
    expect(await sendWinbackEmails(cctx)).toEqual({ sent: 1 });
    expect(f.mailer.sent.filter((m) => m.subject.startsWith("We miss you")).map((m) => m.to)).toEqual(["ada@example.com", "ada@example.com"]);

    // Store files carry the setting.
    const file = await exportStore(f.db, shopId);
    expect(file.store.winback_offer).toEqual({ after_days: 60, percent_off: 15, days: 14 });
  });
});
