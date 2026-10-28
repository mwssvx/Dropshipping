// Numbers behind the AI store review: who buys and comes back, which products get looked at but
// not bought, and why things come back. Worked out here, so the model only reads small summaries.
import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { schema, RETURN_REASONS, type Db } from "@sf/db";

const PAID = ["paid", "partially_refunded", "refunded"] as const;
const DAY = 86_400_000;

/** A customer counts as lapsed when their last order was this long ago (up to a year). */
export const LAPSED_AFTER_DAYS = 90;

/**
 * Buyers over the last N days against the year before: new and returning buyers, how many ever
 * ordered twice, lapsed buyers, and where sales went. Guests count by email.
 */
export async function customerReport(db: Db, shopId: string, days: number, now = new Date()) {
  const from = new Date(now.getTime() - days * DAY);
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const lapsedBefore = new Date(now.getTime() - LAPSED_AFTER_DAYS * DAY);
  const paid = and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), ne(schema.orders.source, "replacement"), isNotNull(schema.orders.paidAt));
  const key = sql<string>`coalesce(${schema.orders.customerId}::text, lower(${schema.orders.email}))`;
  const c = db
    .select({
      key: key.as("key"),
      first: sql<Date>`min(${schema.orders.paidAt})`.as("first"),
      last: sql<Date>`max(${schema.orders.paidAt})`.as("last"),
      orders: sql<number>`count(*)`.as("orders"),
      net: sql<number>`sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor})`.as("net"),
    })
    .from(schema.orders)
    .where(paid)
    .groupBy(key)
    .as("c");
  const [[row], countries, [window]] = await Promise.all([
    db
      .select({
        everyone: sql<number>`count(*)::int`,
        repeat: sql<number>`count(*) filter (where ${c.orders} >= 2)::int`,
        inWindow: sql<number>`count(*) filter (where ${c.last} >= ${from})::int`,
        fresh: sql<number>`count(*) filter (where ${c.first} >= ${from})::int`,
        lapsed: sql<number>`count(*) filter (where ${c.last} < ${lapsedBefore} and ${c.last} >= ${yearAgo})::int`,
        lifetime: sql<number>`coalesce(avg(${c.net}), 0)::bigint`,
      })
      .from(c),
    db
      .select({ country: sql<string>`${schema.orders.shippingAddress}->>'country'`, orders: count(), sales: sql<number>`sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor})::bigint` })
      .from(schema.orders)
      .where(and(paid, gte(schema.orders.paidAt, from)))
      .groupBy(sql`1`)
      .orderBy(desc(sql`3`))
      .limit(5),
    db
      .select({
        orders: count(),
        sales: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)::bigint`,
        discounted: sql<number>`count(*) filter (where ${schema.orders.discountMinor} > 0)::int`,
      })
      .from(schema.orders)
      .where(and(paid, gte(schema.orders.paidAt, from))),
  ]);
  const [consent] = await db
    .select({ all: count(), yes: sql<number>`count(*) filter (where ${schema.customers.acceptsMarketing} and ${schema.customers.unsubscribedAt} is null)::int` })
    .from(schema.customers)
    .where(eq(schema.customers.shopId, shopId));
  const everyone = Number(row?.everyone ?? 0);
  const inWindow = Number(row?.inWindow ?? 0);
  const fresh = Number(row?.fresh ?? 0);
  return {
    days,
    buyers: inWindow,
    newBuyers: fresh,
    returningBuyers: inWindow - fresh,
    /** Of everyone who ever bought, the share who bought at least twice, in percent. */
    repeatPercent: everyone ? Math.round((Number(row!.repeat) / everyone) * 1000) / 10 : null,
    everBought: everyone,
    lapsed: Number(row?.lapsed ?? 0),
    averageLifetimeMinor: Number(row?.lifetime ?? 0),
    orders: Number(window?.orders ?? 0),
    salesMinor: Number(window?.sales ?? 0),
    /** Orders that used a discount code or bundle, in percent. */
    discountedPercent: Number(window?.orders) ? Math.round((Number(window!.discounted) / Number(window!.orders)) * 100) : null,
    topCountries: countries.map((r) => ({ country: r.country, orders: Number(r.orders), salesMinor: Number(r.sales) })),
    emailList: { customers: Number(consent?.all ?? 0), subscribed: Number(consent?.yes ?? 0) },
  };
}

/** Views, adds to cart and sales per product, to spot pages people leave and products nobody finds. */
export async function productFunnel(db: Db, shopId: string, days: number, now = new Date()) {
  const from = new Date(now.getTime() - days * DAY);
  const events = and(eq(schema.storefrontEvents.shopId, shopId), gte(schema.storefrontEvents.createdAt, from), lt(schema.storefrontEvents.createdAt, now), isNotNull(schema.storefrontEvents.productId));
  const [products, seen, sold] = await Promise.all([
    db.query.products.findMany({ where: and(eq(schema.products.shopId, shopId), eq(schema.products.status, "active")), columns: { id: true, title: true, createdAt: true } }),
    db
      .select({
        productId: schema.storefrontEvents.productId,
        views: sql<number>`count(distinct ${schema.storefrontEvents.sessionId}) filter (where ${schema.storefrontEvents.kind} = 'product_view')::int`,
        carts: sql<number>`count(distinct ${schema.storefrontEvents.sessionId}) filter (where ${schema.storefrontEvents.kind} = 'add_to_cart')::int`,
      })
      .from(schema.storefrontEvents)
      .where(events)
      .groupBy(schema.storefrontEvents.productId),
    db
      .select({ productId: schema.variants.productId, units: sql<number>`sum(${schema.orderLines.quantity})::int`, orders: countDistinct(schema.orders.id) })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
      .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), ne(schema.orders.source, "replacement"), gte(schema.orders.paidAt, from)))
      .groupBy(schema.variants.productId),
  ]);
  const rows = products.map((p) => {
    const s = seen.find((r) => r.productId === p.id);
    const o = sold.find((r) => r.productId === p.id);
    const views = Number(s?.views ?? 0);
    const carts = Number(s?.carts ?? 0);
    const orders = Number(o?.orders ?? 0);
    return {
      productId: p.id,
      title: p.title,
      views,
      carts,
      orders,
      units: Number(o?.units ?? 0),
      /** Visitors who viewed it and added it to the cart, in percent. */
      cartPercent: views ? Math.round((carts / views) * 1000) / 10 : null,
      /** Orders per viewer, in percent. */
      buyPercent: views ? Math.round((orders / views) * 1000) / 10 : null,
      newProduct: now.getTime() - p.createdAt.getTime() < days * DAY,
    };
  });
  return {
    days,
    products: rows.length,
    // Plenty of interest, few adds: often the price, photos or delivery time.
    viewedNotAdded: rows.filter((r) => r.views >= 20 && (r.cartPercent ?? 0) < 3).sort((a, b) => b.views - a.views).slice(0, 8),
    // Added but rarely bought: shipping cost or checkout surprises.
    addedNotBought: rows.filter((r) => r.carts >= 5 && r.orders / r.carts < 0.2).sort((a, b) => b.carts - a.carts).slice(0, 8),
    // On sale but nobody found them, unless they're new.
    notSeen: rows.filter((r) => r.views < 3 && !r.newProduct).map((r) => r.title).slice(0, 10),
    notSeenCount: rows.filter((r) => r.views < 3 && !r.newProduct).length,
    bestConverting: rows.filter((r) => r.views >= 10 && r.orders > 0).sort((a, b) => (b.buyPercent ?? 0) - (a.buyPercent ?? 0)).slice(0, 5),
  };
}

export const RETURN_REASON_TEXT: Record<(typeof RETURN_REASONS)[number], string> = {
  never_arrived: "never arrived",
  damaged: "arrived damaged",
  wrong_item: "wrong item",
  not_as_described: "not as described",
  too_small_or_big: "wrong size",
  changed_mind: "changed their mind",
  other: "other",
};

/** Return requests and refunds over the last N days: why, and which products. */
export async function returnsReport(db: Db, shopId: string, days: number, now = new Date()) {
  const from = new Date(now.getTime() - days * DAY);
  const [requests, [refunded]] = await Promise.all([
    db.query.returnRequests.findMany({ where: and(eq(schema.returnRequests.shopId, shopId), gte(schema.returnRequests.createdAt, from)), columns: { reason: true, items: true } }),
    db
      .select({ n: count(), amount: sql<number>`coalesce(sum(${schema.refunds.amountMinor}), 0)::bigint` })
      .from(schema.refunds)
      .where(and(eq(schema.refunds.shopId, shopId), gte(schema.refunds.createdAt, from))),
  ]);
  const reasons = new Map<string, number>();
  const products = new Map<string, { returns: number; reasons: Map<string, number> }>();
  for (const r of requests) {
    reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    for (const item of r.items) {
      const p = products.get(item.title) ?? { returns: 0, reasons: new Map() };
      p.returns += item.quantity;
      p.reasons.set(r.reason, (p.reasons.get(r.reason) ?? 0) + 1);
      products.set(item.title, p);
    }
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]);
  return {
    days,
    requests: requests.length,
    refunds: Number(refunded?.n ?? 0),
    refundedMinor: Number(refunded?.amount ?? 0),
    reasons: top(reasons).map(([reason, n]) => ({ reason: RETURN_REASON_TEXT[reason as keyof typeof RETURN_REASON_TEXT] ?? reason, requests: n })),
    products: [...products]
      .sort((a, b) => b[1].returns - a[1].returns)
      .slice(0, 5)
      .map(([title, p]) => ({ title, returned: p.returns, mainReason: RETURN_REASON_TEXT[top(p.reasons)[0]![0] as keyof typeof RETURN_REASON_TEXT] })),
  };
}
