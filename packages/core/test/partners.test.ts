import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  commissionOn,
  createPartner,
  DemoModel,
  formatRate,
  handlePaymentEvent,
  listDiscounts,
  listPartners,
  LogMailer,
  partnerPortal,
  recordPartnerPayout,
  resetPartnerLink,
  setPartnerActive,
  startCheckout,
} from "../src";
import { DAY, makeFixture } from "../evals/fixture";

const address = { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" };

async function setup() {
  const f = await makeFixture(new DemoModel());
  const [lamp] = await f.variants(f.products.lamp.id);
  const mailer = new LogMailer(true);
  const ctx = { db: f.db, mailer, partnerUrl: (t: string) => `https://app.example/partner/${t}`, storeUrl: () => "https://glow.example" };
  const buy = async (code: string, email: string, quantity = 1) => {
    const { order } = await startCheckout(f.db, f.payments, await f.shop(), { email, address, lines: [{ variantId: lamp!.id, quantity }], discountCode: code });
    const { body, signature } = f.payments.succeededEvent(order.paymentIntentId!, order.totalMinor);
    await handlePaymentEvent(f.db, "fake", (await f.payments.parseWebhook(body, signature))!);
    return (await f.db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))!;
  };
  return { ...f, ctx, mailer, lamp: lamp!, buy };
}

describe("partners", () => {
  it("works out a share of the goods, after the discount and less refunds", () => {
    expect(commissionOn({ subtotalMinor: 10_000, discountMinor: 1_000, refundedMinor: 0 }, 1000)).toBe(900);
    expect(commissionOn({ subtotalMinor: 10_000, discountMinor: 1_000, refundedMinor: 9_500 }, 1000)).toBe(0);
    expect(commissionOn({ subtotalMinor: 999, discountMinor: 0, refundedMinor: 0 }, 750)).toBe(74);
    expect([formatRate(1000), formatRate(750), formatRate(1234)]).toEqual(["10%", "7.5%", "12.34%"]);
  });

  it("gives a partner a code, counts orders paid with it, and tracks what they're owed", async () => {
    const f = await setup();
    const shop = await f.shop();
    const p = await createPartner(f.ctx, shop, { name: "Maya Creates", email: " Maya@Example.com ", code: "maya15", percentOff: 15, commissionPercent: 10 });
    expect(p).toMatchObject({ code: "MAYA15", email: "maya@example.com", commissionBps: 1000, active: true });
    // They're sent their code, a share link and their private page.
    expect(f.mailer.sent[0]).toMatchObject({ to: "maya@example.com", subject: "Your code for Glow Lamps: MAYA15" });
    expect(f.mailer.sent[0]!.text).toContain("https://glow.example/discount/MAYA15");
    expect(f.mailer.sent[0]!.text).toContain(`https://app.example/partner/${p.portalToken}`);
    // Partner codes aren't on the codes list.
    expect(await listDiscounts(f.db, shop.id)).toEqual([]);
    await expect(createPartner(f.ctx, shop, { name: "Copy", code: "MAYA15", percentOff: 10, commissionPercent: 5 })).rejects.toThrow("already have a code");
    await expect(createPartner(f.ctx, shop, { name: "Greedy", code: "GREEDY", percentOff: 10, commissionPercent: 60 })).rejects.toThrow("0% to 50%");

    const a = await f.buy("MAYA15", "ada@example.com", 2);
    const b = await f.buy("maya15", "grace@example.com");
    expect(a.discountMinor).toBe(Math.floor((f.lamp.priceMinor * 2 * 15) / 100));
    // An order without the code doesn't count.
    await f.order(f.products.lamp.id);

    const share = (o: typeof a) => commissionOn(o, 1000);
    let [row] = await listPartners(f.db, shop.id);
    expect(row).toMatchObject({ code: "MAYA15", percentOff: 15, orders: 2, earnedMinor: 0, pendingMinor: share(a) + share(b), owedMinor: 0 });
    await expect(recordPartnerPayout(f.db, shop, p.id, { amountMinor: 100 })).rejects.toThrow("isn't owed anything");

    // Delivered: earned. The other one is earned once 30 days have passed, unless it's refunded.
    await f.db.update(schema.orders).set({ fulfillmentStatus: "delivered" }).where(eq(schema.orders.id, a.id));
    [row] = await listPartners(f.db, shop.id);
    expect(row).toMatchObject({ earnedMinor: share(a), pendingMinor: share(b), owedMinor: share(a) });
    await expect(recordPartnerPayout(f.db, shop, p.id, { amountMinor: share(a) + 1 })).rejects.toThrow(/is owed \$/);
    await recordPartnerPayout(f.db, shop, p.id, { amountMinor: share(a), note: "PayPal" });

    await f.db.update(schema.orders).set({ paymentStatus: "refunded", refundedMinor: b.totalMinor }).where(eq(schema.orders.id, b.id));
    const later = new Date(Date.now() + 31 * DAY);
    [row] = await listPartners(f.db, shop.id, later);
    expect(row).toMatchObject({ orders: 2, earnedMinor: share(a), pendingMinor: 0, paidMinor: share(a), owedMinor: 0 });

    // Their private page: their numbers and orders, no buyer details.
    const portal = (await partnerPortal(f.db, p.portalToken, later))!;
    expect(portal).toMatchObject({ code: "MAYA15", percentOff: 15, partner: { name: "Maya Creates", rate: "10%" }, shop: { name: "Glow Lamps" } });
    expect(portal.orders.map((o) => o.status)).toEqual(["refunded", "earned"]);
    expect(portal.payouts).toEqual([expect.objectContaining({ amountMinor: share(a), note: "PayPal" })]);
    expect(JSON.stringify(portal)).not.toContain("example.com");
    expect(await partnerPortal(f.db, "nope")).toBeNull();

    // A new link: the old one stops working.
    const fresh = await resetPartnerLink(f.db, shop.id, p.id);
    expect(fresh.portalToken).not.toBe(p.portalToken);
    expect(await partnerPortal(f.db, p.portalToken)).toBeNull();
    expect(await partnerPortal(f.db, fresh.portalToken)).not.toBeNull();

    // Paused: the code stops working at checkout.
    await setPartnerActive(f.db, shop.id, p.id, false);
    await expect(f.buy("MAYA15", "linus@example.com")).rejects.toThrow(`"MAYA15" isn't a valid code.`);
    await setPartnerActive(f.db, shop.id, p.id, true);
    await f.buy("MAYA15", "linus@example.com");
  });

  it("keeps partners to their own store", async () => {
    const f = await setup();
    const shop = await f.shop();
    const p = await createPartner({ ...f.ctx, mailer: undefined }, shop, { name: "Sam", code: "SAM10", percentOff: 10, commissionPercent: 7.5 });
    expect(p.commissionBps).toBe(750);
    const other = await f.db.insert(schema.shops).values({ name: "Other", handle: "other-store", country: "US", currency: "USD" }).returning();
    await expect(setPartnerActive(f.db, other[0]!.id, p.id, false)).rejects.toThrow("not found");
    expect(await listPartners(f.db, other[0]!.id)).toEqual([]);
  });
});
