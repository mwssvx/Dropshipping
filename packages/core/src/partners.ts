// Partners: people who promote the store with their own code (a creator, a blogger, a friend with a
// following). Buyers who use the code get money off; the partner earns a share of what those orders
// paid for goods, after the discount and less refunds. A share is "earned" once the order is
// delivered, or 30 days after it was paid, so returns come off first. The merchant pays partners
// however they like and records each payment here. Every partner has a private link showing their
// own numbers, with no buyer details.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { createDiscount } from "./discounts";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;
export type Partner = typeof schema.partners.$inferSelect;
export type PartnerContext = { db: Db; mailer?: Mailer; partnerUrl: (token: string) => string; storeUrl?: (shop: Shop) => string };

const DAY = 86_400_000;
/** How long after payment a partner's share counts as earned, when the order hasn't been marked delivered. */
export const PARTNER_HOLD_DAYS = 30;
const PAID = ["paid", "partially_refunded", "refunded"] as const;

const partnerInput = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(80, "Keep the name under 80 characters."),
  email: z.preprocess((v) => (typeof v === "string" && !v.trim() ? undefined : v), z.string().trim().toLowerCase().max(200).email("Enter a valid email address.").optional()),
  code: z.string(),
  percentOff: z.number().int().min(1, "Buyers get 1% to 50% off with the code.").max(50, "Buyers get 1% to 50% off with the code."),
  commissionPercent: z.number().min(0, "Their share is 0% to 50%.").max(50, "Their share is 0% to 50%."),
});

export type PartnerInput = z.input<typeof partnerInput>;

/** One order's share: goods paid for after the discount, less refunds, times the rate. Rounds down. */
export const commissionOn = (o: { subtotalMinor: number; discountMinor: number; refundedMinor: number }, bps: number) =>
  Math.floor((Math.max(0, o.subtotalMinor - o.discountMinor - o.refundedMinor) * bps) / 10_000);

/** "10%" or "7.5%". */
export const formatRate = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? (bps % 10 ? 2 : 1) : 0)}%`;

/**
 * Adds a partner with their own code. When they have an email, they're sent their code and private
 * link straight away.
 */
export async function createPartner(ctx: PartnerContext, shop: Shop, input: PartnerInput) {
  const parsed = partnerInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const p = parsed.data;
  const partner = await ctx.db.transaction(async (tx) => {
    const discount = await createDiscount(tx as unknown as Db, shop.id, { code: p.code, kind: "percent", value: p.percentOff });
    await tx.update(schema.discounts).set({ source: "partner" }).where(eq(schema.discounts.id, discount.id));
    const [row] = await tx
      .insert(schema.partners)
      .values({ shopId: shop.id, name: p.name, email: p.email ?? null, discountId: discount.id, commissionBps: Math.round(p.commissionPercent * 100) })
      .returning();
    return { ...row!, code: discount.code };
  });
  if (partner.email && ctx.mailer) {
    const store = ctx.storeUrl?.(shop);
    await ctx.mailer.send({
      to: partner.email,
      subject: `Your code for ${shop.name}: ${partner.code}`,
      text: [
        `Hi ${partner.name},`,
        ``,
        `${shop.name} gave you your own code: ${partner.code}. Buyers who use it get ${p.percentOff}% off, and you get ${formatRate(partner.commissionBps)} of what they pay for their items.`,
        ...(store ? [``, `Share this link and the code is applied for them: ${store}/discount/${partner.code}`] : []),
        ``,
        `See your orders and what you've earned here (keep this link to yourself): ${ctx.partnerUrl(partner.portalToken)}`,
      ].join("\n"),
    });
  }
  return partner;
}

type Totals = { orders: number; salesMinor: number; earnedMinor: number; pendingMinor: number; paidMinor: number; owedMinor: number };

/** Each partner's orders and money, worked out from the orders paid with their code. */
async function totalsFor(db: Db, shopId: string, partners: Pick<Partner, "id" | "discountId" | "commissionBps">[], now: Date) {
  const out = new Map<string, Totals>(partners.map((p) => [p.id, { orders: 0, salesMinor: 0, earnedMinor: 0, pendingMinor: 0, paidMinor: 0, owedMinor: 0 }]));
  if (!partners.length) return out;
  const byDiscount = new Map(partners.map((p) => [p.discountId, p]));
  const orders = await db
    .select({
      discountId: schema.orders.discountId,
      subtotalMinor: schema.orders.subtotalMinor,
      discountMinor: schema.orders.discountMinor,
      refundedMinor: schema.orders.refundedMinor,
      fulfillmentStatus: schema.orders.fulfillmentStatus,
      paidAt: schema.orders.paidAt,
      createdAt: schema.orders.createdAt,
    })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), inArray(schema.orders.discountId, [...byDiscount.keys()])));
  for (const o of orders) {
    const p = byDiscount.get(o.discountId!)!;
    const t = out.get(p.id)!;
    t.orders++;
    t.salesMinor += Math.max(0, o.subtotalMinor - o.discountMinor - o.refundedMinor);
    const share = commissionOn(o, p.commissionBps);
    if (isEarned(o, now)) t.earnedMinor += share;
    else t.pendingMinor += share;
  }
  const paid = await db
    .select({ partnerId: schema.partnerPayouts.partnerId, sum: sql<number>`coalesce(sum(${schema.partnerPayouts.amountMinor}), 0)::bigint` })
    .from(schema.partnerPayouts)
    .where(and(eq(schema.partnerPayouts.shopId, shopId), inArray(schema.partnerPayouts.partnerId, partners.map((p) => p.id))))
    .groupBy(schema.partnerPayouts.partnerId);
  for (const r of paid) out.get(r.partnerId)!.paidMinor = Number(r.sum);
  // A refund after they were paid can leave them owing; that comes off what they earn next.
  for (const t of out.values()) t.owedMinor = Math.max(0, t.earnedMinor - t.paidMinor);
  return out;
}

const isEarned = (o: { fulfillmentStatus: string; paidAt: Date | null; createdAt: Date }, now: Date) =>
  o.fulfillmentStatus === "delivered" || (o.paidAt ?? o.createdAt).getTime() <= now.getTime() - PARTNER_HOLD_DAYS * DAY;

/** Partners for the admin page, newest first, with their code and money. */
export async function listPartners(db: Db, shopId: string, now = new Date()) {
  const rows = await db
    .select({ partner: schema.partners, code: schema.discounts.code, percentOff: schema.discounts.value })
    .from(schema.partners)
    .innerJoin(schema.discounts, eq(schema.discounts.id, schema.partners.discountId))
    .where(eq(schema.partners.shopId, shopId))
    .orderBy(desc(schema.partners.createdAt));
  const totals = await totalsFor(db, shopId, rows.map((r) => r.partner), now);
  return rows.map((r) => ({ ...r.partner, code: r.code, percentOff: r.percentOff, ...totals.get(r.partner.id)! }));
}

async function ownPartner(db: Db, shopId: string, id: string) {
  const partner = await db.query.partners.findFirst({ where: and(eq(schema.partners.id, id), eq(schema.partners.shopId, shopId)) });
  if (!partner) throw new NotFoundError("Partner");
  return partner;
}

/** Pauses a partner (their code stops working) or brings them back. What they earned stays. */
export async function setPartnerActive(db: Db, shopId: string, id: string, active: boolean) {
  const partner = await ownPartner(db, shopId, id);
  await db.transaction(async (tx) => {
    await tx.update(schema.partners).set({ active }).where(eq(schema.partners.id, partner.id));
    await tx.update(schema.discounts).set({ active }).where(eq(schema.discounts.id, partner.discountId));
  });
  return { ...partner, active };
}

const payoutInput = z.object({
  amountMinor: z.number().int().min(1, "Enter what you paid them."),
  note: z.string().trim().max(200, "Keep the note under 200 characters.").optional(),
});

/** Records money the merchant paid a partner. It can't be more than they're owed. */
export async function recordPartnerPayout(db: Db, shop: Shop, partnerId: string, input: z.input<typeof payoutInput>, now = new Date()) {
  const parsed = payoutInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const partner = await ownPartner(db, shop.id, partnerId);
  const owed = (await totalsFor(db, shop.id, [partner], now)).get(partner.id)!.owedMinor;
  if (parsed.data.amountMinor > owed) {
    throw new UserError(owed ? `${partner.name} is owed ${formatMoney(owed, shop.currency)}. Record up to that.` : `${partner.name} isn't owed anything right now.`);
  }
  const [row] = await db
    .insert(schema.partnerPayouts)
    .values({ shopId: shop.id, partnerId: partner.id, amountMinor: parsed.data.amountMinor, note: parsed.data.note || null, paidAt: now })
    .returning();
  return { payout: row!, partner };
}

/** Gives a partner a new private link; the old one stops working. */
export async function resetPartnerLink(db: Db, shopId: string, id: string) {
  const partner = await ownPartner(db, shopId, id);
  const [row] = await db
    .update(schema.partners)
    .set({ portalToken: sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')` })
    .where(eq(schema.partners.id, partner.id))
    .returning();
  return row!;
}

/** What a partner sees on their private page: their code, their numbers and their orders, without buyer details. */
export async function partnerPortal(db: Db, token: string, now = new Date()) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const partner = await db.query.partners.findFirst({ where: eq(schema.partners.portalToken, token) });
  if (!partner) return null;
  const [shop, discount] = await Promise.all([
    db.query.shops.findFirst({ where: eq(schema.shops.id, partner.shopId) }),
    db.query.discounts.findFirst({ where: eq(schema.discounts.id, partner.discountId) }),
  ]);
  const totals = (await totalsFor(db, partner.shopId, [partner], now)).get(partner.id)!;
  const orders = await db
    .select({
      subtotalMinor: schema.orders.subtotalMinor,
      discountMinor: schema.orders.discountMinor,
      refundedMinor: schema.orders.refundedMinor,
      totalMinor: schema.orders.totalMinor,
      fulfillmentStatus: schema.orders.fulfillmentStatus,
      paidAt: schema.orders.paidAt,
      createdAt: schema.orders.createdAt,
    })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, partner.shopId), eq(schema.orders.discountId, partner.discountId), inArray(schema.orders.paymentStatus, [...PAID])))
    .orderBy(desc(schema.orders.createdAt))
    .limit(50);
  const payouts = await db.query.partnerPayouts.findMany({ where: eq(schema.partnerPayouts.partnerId, partner.id), orderBy: desc(schema.partnerPayouts.paidAt), limit: 50 });
  return {
    partner: { name: partner.name, active: partner.active, rate: formatRate(partner.commissionBps) },
    shop: { id: shop!.id, name: shop!.name, handle: shop!.handle, currency: shop!.currency },
    code: discount!.code,
    percentOff: discount!.value,
    totals,
    orders: orders.map((o) => ({
      date: o.paidAt ?? o.createdAt,
      goodsMinor: Math.max(0, o.subtotalMinor - o.discountMinor - o.refundedMinor),
      shareMinor: commissionOn(o, partner.commissionBps),
      status: o.refundedMinor >= o.totalMinor ? ("refunded" as const) : isEarned(o, now) ? ("earned" as const) : ("pending" as const),
    })),
    payouts: payouts.map((p) => ({ amountMinor: p.amountMinor, note: p.note, paidAt: p.paidAt })),
  };
}
