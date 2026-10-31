// Small growth tools: abandoned checkout reminders, "goes well with" and "often bought together"
// suggestions, and their settings.
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { sendOrderEmail, type FulfillmentContext } from "./fulfillment";
import { sendBrowseReminders } from "./browse-reminders";

const HOUR = 3_600_000;

export async function setGrowthSettings(db: Db, shopId: string, input: { abandonedCartEmails?: boolean; reviewsAutoPublish?: boolean }) {
  const set: Partial<typeof schema.shops.$inferInsert> = { updatedAt: new Date() };
  if (input.abandonedCartEmails !== undefined) set.abandonedCartEmails = input.abandonedCartEmails;
  if (input.reviewsAutoPublish !== undefined) set.reviewsAutoPublish = input.reviewsAutoPublish;
  await db.update(schema.shops).set(set).where(eq(schema.shops.id, shopId));
}

/**
 * One reminder for checkouts started 1 to 48 hours ago and never paid, unless the buyer has paid
 * for another order since, or was reminded in the last day about a different checkout.
 */
export async function sendAbandonedCartEmails(ctx: FulfillmentContext, now = new Date()) {
  const { db } = ctx;
  const candidates = await db
    .select({ order: schema.orders })
    .from(schema.orders)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
    .where(
      and(
        eq(schema.orders.paymentStatus, "pending"),
        // Payment links aren't abandoned checkouts: the merchant follows those up themselves.
        eq(schema.orders.source, "checkout"),
        // Nor is an order waiting for the buyer's bank transfer.
        isNull(schema.orders.manualPayment),
        lte(schema.orders.createdAt, new Date(now.getTime() - HOUR)),
        gte(schema.orders.createdAt, new Date(now.getTime() - 48 * HOUR)),
        eq(schema.shops.abandonedCartEmails, true),
        eq(schema.shops.status, "active"),
        sql`not exists (select 1 from ${schema.emails} e where e.order_id = ${schema.orders.id} and e.kind = 'abandoned_cart')`,
      ),
    )
    .limit(500);
  let sent = 0;
  for (const { order } of candidates) {
    const [paidSince] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.shopId, order.shopId), eq(schema.orders.email, order.email), ne(schema.orders.paymentStatus, "pending"), ne(schema.orders.paymentStatus, "failed"), gte(schema.orders.createdAt, order.createdAt)))
      .limit(1);
    if (paidSince) continue;
    const [recent] = await db
      .select({ id: schema.emails.id })
      .from(schema.emails)
      .where(and(eq(schema.emails.shopId, order.shopId), eq(schema.emails.kind, "abandoned_cart"), eq(schema.emails.to, order.email), gte(schema.emails.createdAt, new Date(now.getTime() - 24 * HOUR))))
      .limit(1);
    if (recent) continue;
    if ((await sendOrderEmail(ctx, order.id, "abandoned_cart")).status === "sent") sent++;
  }
  // Browse reminders run alongside: same hourly job, same kind of nudge.
  return { sent, offers: await sendAbandonedCartOffers(ctx, now), browse: (await sendBrowseReminders(ctx, now)).sent };
}

// The second reminder: a day after the first, for checkouts up to four days old.
const OFFER_AFTER = 24 * HOUR;
const OFFER_WINDOW = 96 * HOUR;
const OFFER_LASTS = 48 * HOUR;
// No 0/O or 1/I, so codes can be read out and typed from a phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const reminderCode = () => `BACK-${[...randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;

/** Whether checkout asks for a phone number for the courier. */
export async function setCheckoutPhone(db: Db, shopId: string, mode: "off" | "optional" | "required") {
  if (!["off", "optional", "required"].includes(mode)) throw new UserError("Pick whether checkout asks for a phone number.");
  await db.update(schema.shops).set({ checkoutPhone: mode, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

/** Turns the second reminder on with a percentage off, or off with null. */
export async function setAbandonedCartOffer(db: Db, shopId: string, percentOff: number | null) {
  if (percentOff !== null && (!Number.isInteger(percentOff) || percentOff < 5 || percentOff > 50)) {
    throw new UserError("Pick between 5% and 50% off.");
  }
  await db.update(schema.shops).set({ abandonedCartOffer: percentOff === null ? null : { percentOff }, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

/**
 * A second reminder with a one-time code, a day after the first, for stores that turned it on.
 * The code works once, only with the buyer's email, for 48 hours. Skipped when the buyer paid for
 * any order since, and sent once per buyer per four days, so starting a checkout and leaving it
 * isn't a way to farm codes.
 */
async function sendAbandonedCartOffers(ctx: FulfillmentContext, now: Date) {
  const { db } = ctx;
  const first = alias(schema.emails, "first");
  const candidates = await db
    .select({ order: schema.orders, offer: schema.shops.abandonedCartOffer })
    .from(schema.orders)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
    .innerJoin(first, and(eq(first.orderId, schema.orders.id), eq(first.kind, "abandoned_cart"), lte(first.createdAt, new Date(now.getTime() - OFFER_AFTER))))
    .where(
      and(
        eq(schema.orders.paymentStatus, "pending"),
        eq(schema.orders.source, "checkout"),
        isNull(schema.orders.manualPayment),
        gte(schema.orders.createdAt, new Date(now.getTime() - OFFER_WINDOW)),
        sql`${schema.shops.abandonedCartOffer} is not null`,
        eq(schema.shops.abandonedCartEmails, true),
        eq(schema.shops.status, "active"),
        sql`not exists (select 1 from ${schema.emails} e where e.order_id = ${schema.orders.id} and e.kind = 'abandoned_cart_offer')`,
      ),
    )
    .limit(500);
  let sent = 0;
  for (const { order, offer } of candidates) {
    const [paidSince] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.shopId, order.shopId), eq(schema.orders.email, order.email), notInArray(schema.orders.paymentStatus, ["pending", "failed"]), gte(schema.orders.createdAt, order.createdAt)))
      .limit(1);
    if (paidSince) continue;
    const [recent] = await db
      .select({ id: schema.emails.id })
      .from(schema.emails)
      .where(and(eq(schema.emails.shopId, order.shopId), eq(schema.emails.kind, "abandoned_cart_offer"), eq(schema.emails.to, order.email), gte(schema.emails.createdAt, new Date(now.getTime() - OFFER_WINDOW))))
      .limit(1);
    if (recent) continue;
    let code: typeof schema.discounts.$inferSelect | undefined;
    for (let i = 0; i < 5 && !code; i++) {
      [code] = await db
        .insert(schema.discounts)
        .values({
          shopId: order.shopId,
          code: reminderCode(),
          kind: "percent",
          value: offer!.percentOff,
          usageLimit: 1,
          oncePerCustomer: true,
          endsAt: new Date(now.getTime() + OFFER_LASTS),
          source: "reminder",
          email: order.email.toLowerCase(),
        })
        .onConflictDoNothing()
        .returning();
    }
    if (!code) continue;
    if ((await sendOrderEmail(ctx, order.id, "abandoned_cart_offer", code.code)).status === "sent") sent++;
  }
  return sent;
}

/** Reminders sent since a date, and how many of those checkouts were then paid. */
export async function abandonedCartStats(db: Db, shopId: string, since: Date) {
  const rows = await db
    .select({ paid: schema.orders.paymentStatus, total: schema.orders.totalMinor })
    .from(schema.emails)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.emails.orderId))
    .where(and(eq(schema.emails.shopId, shopId), eq(schema.emails.kind, "abandoned_cart"), gte(schema.emails.createdAt, since)));
  const recovered = rows.filter((r) => ["paid", "partially_refunded", "refunded"].includes(r.paid));
  // A second reminder's code is used on a new checkout, so those are counted by the code.
  const [offers] = await db
    .select({ sent: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.emails)
    .where(and(eq(schema.emails.shopId, shopId), eq(schema.emails.kind, "abandoned_cart_offer"), gte(schema.emails.createdAt, since)));
  const won = await db
    .select({ total: schema.orders.totalMinor })
    .from(schema.orders)
    .innerJoin(schema.discounts, eq(schema.discounts.id, schema.orders.discountId))
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.discounts.source, "reminder"), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded", "refunded"]), gte(schema.orders.createdAt, since)));
  return {
    sent: rows.length + offers!.sent,
    recovered: recovered.length + won.length,
    recoveredMinor: recovered.reduce((s, r) => s + r.total, 0) + won.reduce((s, r) => s + r.total, 0),
  };
}

export async function setUpsell(db: Db, shopId: string, productId: string, upsellProductId: string | null) {
  if (upsellProductId) {
    if (upsellProductId === productId) throw new UserError("Pick a different product to suggest.");
    const other = await db.query.products.findFirst({ where: and(eq(schema.products.id, upsellProductId), eq(schema.products.shopId, shopId)) });
    if (!other) throw new NotFoundError("Product");
  }
  const [row] = await db
    .update(schema.products)
    .set({ upsellProductId, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Product");
  return row;
}

/** Products suggested for these ones, on sale and not already among them, with their first price. */
export async function upsellsFor(db: Db, shopId: string, productIds: string[]) {
  if (!productIds.length) return [];
  const from = await db.query.products.findMany({ where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, productIds)) });
  const ids = [...new Set(from.map((p) => p.upsellProductId).filter((x): x is string => !!x && !productIds.includes(x)))];
  if (!ids.length) return [];
  const products = await db.query.products.findMany({ where: and(inArray(schema.products.id, ids), eq(schema.products.status, "active")) });
  const variants = await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)), orderBy: schema.variants.position });
  return products
    .map((p) => {
      const v = variants.find((x) => x.productId === p.id && (x.stock === null || x.stock > 0));
      return v ? { id: p.id, handle: p.handle, title: p.title, imageUrl: p.imageUrl, variantId: v.id, priceMinor: v.priceMinor } : null;
    })
    .filter((x) => x !== null);
}

/** Paid orders needed before two products count as bought together. */
export const BOUGHT_TOGETHER_MIN_ORDERS = 2;

/**
 * Products that buyers of these products also bought in the same order, most often first, from
 * the last 180 days of paid orders. Only active products with something in stock, never the
 * products asked about, and only pairs seen in at least two orders.
 */
export async function boughtTogether(db: Db, shopId: string, productIds: string[], opts: { limit?: number; days?: number; now?: Date } = {}) {
  if (!productIds.length) return [];
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.days ?? 180) * 86_400_000);
  const mine = alias(schema.orderLines, "mine");
  const mineV = alias(schema.variants, "mine_v");
  const other = alias(schema.orderLines, "other");
  const otherV = alias(schema.variants, "other_v");
  const orders = sql<number>`count(distinct ${mine.orderId})::int`;
  const pairs = await db
    .select({ productId: otherV.productId, orders })
    .from(mine)
    .innerJoin(mineV, eq(mineV.id, mine.variantId))
    .innerJoin(schema.orders, eq(schema.orders.id, mine.orderId))
    .innerJoin(other, and(eq(other.orderId, mine.orderId), ne(other.id, mine.id)))
    .innerJoin(otherV, eq(otherV.id, other.variantId))
    .where(
      and(
        eq(schema.orders.shopId, shopId),
        inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]),
        gt(schema.orders.paidAt, since),
        // Free replacements and repeat deliveries aren't a buyer choosing two things.
        notInArray(schema.orders.source, ["replacement", "subscription"]),
        inArray(mineV.productId, productIds),
        notInArray(otherV.productId, productIds),
      ),
    )
    .groupBy(otherV.productId)
    .having(sql`${orders} >= ${BOUGHT_TOGETHER_MIN_ORDERS}`)
    .orderBy(desc(orders))
    .limit(20);
  if (!pairs.length) return [];
  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, pairs.map((p) => p.productId)), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)),
  });
  const variants = await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)), orderBy: schema.variants.position });
  return pairs
    .map((pair) => {
      const p = products.find((x) => x.id === pair.productId);
      const v = p && variants.find((x) => x.productId === p.id && (x.stock === null || x.stock > 0));
      return p && v ? { id: p.id, handle: p.handle, title: p.title, imageUrl: p.imageUrl, variantId: v.id, priceMinor: v.priceMinor, orders: pair.orders } : null;
    })
    .filter((x) => x !== null)
    .slice(0, opts.limit ?? 3);
}
