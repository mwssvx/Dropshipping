// Store analytics: what visitors did (storefront_events) and what they bought (orders).
import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { schema, STOREFRONT_EVENTS, type Db, type StorefrontEventKind } from "@sf/db";

const PAID = ["paid", "partially_refunded", "refunded"] as const;
const DAY = 86_400_000;

/** Keeps one visitor action. Bad input is dropped quietly: this runs on every page view. */
export async function recordEvent(
  db: Db,
  shopId: string,
  input: { sessionId: string; kind: string; productId?: string | null; referrer?: string | null; host?: string | null },
) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.sessionId)) return false;
  if (!(STOREFRONT_EVENTS as readonly string[]).includes(input.kind)) return false;
  const productId = input.productId && /^[0-9a-f-]{36}$/i.test(input.productId) ? input.productId : null;
  if (productId) {
    const p = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)), columns: { id: true } });
    if (!p) return false;
  }
  await db.insert(schema.storefrontEvents).values({ shopId, sessionId: input.sessionId, kind: input.kind as StorefrontEventKind, productId, source: sourceOf(input.referrer, input.host) });
  return true;
}

/** The referring site's host, or null for direct visits and links inside the store. */
export function sourceOf(referrer: string | null | undefined, ownHost: string | null | undefined) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "").replace(/^(l|m)\.(facebook|instagram)\.com$/, "$2.com");
    if (!host || (ownHost && host === ownHost.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, ""))) return null;
    return host.slice(0, 100);
  } catch {
    return null;
  }
}

export type AnalyticsRange = { from: Date; to: Date };

/** Sales by day, the visitor funnel, best sellers and where visitors came from. `to` is exclusive. */
export async function analyticsReport(db: Db, shopId: string, range: AnalyticsRange) {
  const inRange = (col: typeof schema.orders.paidAt | typeof schema.storefrontEvents.createdAt) => and(gte(col, range.from), lt(col, range.to));
  const paid = and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), inRange(schema.orders.paidAt));
  const events = and(eq(schema.storefrontEvents.shopId, shopId), inRange(schema.storefrontEvents.createdAt));
  const day = (col: unknown) => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD')`;

  const [salesByDay, visitorsByDay, funnelRows, [visitorRow], top, views, sources, [referred]] = await Promise.all([
    db
      .select({ day: day(schema.orders.paidAt), sales: sql<number>`sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor})::bigint`, orders: count() })
      .from(schema.orders)
      .where(paid)
      .groupBy(day(schema.orders.paidAt)),
    db.select({ day: day(schema.storefrontEvents.createdAt), visitors: countDistinct(schema.storefrontEvents.sessionId) }).from(schema.storefrontEvents).where(events).groupBy(day(schema.storefrontEvents.createdAt)),
    db.select({ kind: schema.storefrontEvents.kind, sessions: countDistinct(schema.storefrontEvents.sessionId) }).from(schema.storefrontEvents).where(events).groupBy(schema.storefrontEvents.kind),
    db.select({ n: countDistinct(schema.storefrontEvents.sessionId) }).from(schema.storefrontEvents).where(events),
    db
      .select({
        productId: schema.variants.productId,
        title: sql<string>`coalesce(${schema.products.title}, min(${schema.orderLines.title}))`,
        units: sql<number>`sum(${schema.orderLines.quantity})::int`,
        sales: sql<number>`sum(${schema.orderLines.quantity} * ${schema.orderLines.unitPriceMinor})::bigint`,
      })
      .from(schema.orderLines)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
      .leftJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
      .leftJoin(schema.products, eq(schema.products.id, schema.variants.productId))
      .where(paid)
      .groupBy(schema.variants.productId, schema.products.title)
      .orderBy(desc(sql`4`))
      .limit(10),
    db
      .select({ productId: schema.storefrontEvents.productId, views: count() })
      .from(schema.storefrontEvents)
      .where(and(events, eq(schema.storefrontEvents.kind, "product_view")))
      .groupBy(schema.storefrontEvents.productId),
    db
      .select({ source: schema.storefrontEvents.source, visitors: countDistinct(schema.storefrontEvents.sessionId) })
      .from(schema.storefrontEvents)
      .where(and(events, isNotNull(schema.storefrontEvents.source)))
      .groupBy(schema.storefrontEvents.source)
      .orderBy(desc(sql`2`))
      .limit(5),
    db.select({ n: countDistinct(schema.storefrontEvents.sessionId) }).from(schema.storefrontEvents).where(and(events, isNotNull(schema.storefrontEvents.source))),
  ]);

  const days: { date: string; salesMinor: number; orders: number; visitors: number }[] = [];
  for (let t = Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate()); t < range.to.getTime(); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const s = salesByDay.find((r) => r.day === date);
    days.push({ date, salesMinor: Number(s?.sales ?? 0), orders: Number(s?.orders ?? 0), visitors: Number(visitorsByDay.find((r) => r.day === date)?.visitors ?? 0) });
  }
  const salesMinor = days.reduce((s, d) => s + d.salesMinor, 0);
  const orders = days.reduce((s, d) => s + d.orders, 0);
  const visitors = Number(visitorRow?.n ?? 0);
  const sessions = (k: StorefrontEventKind) => Number(funnelRows.find((r) => r.kind === k)?.sessions ?? 0);
  return {
    days,
    salesMinor,
    orders,
    averageOrderMinor: orders ? Math.round(salesMinor / orders) : 0,
    visitors,
    // Orders per visitor. Null until there are visitors to divide by.
    conversion: visitors ? Math.min(1, orders / visitors) : null,
    funnel: [
      { step: "Visited the store", count: visitors },
      { step: "Looked at a product", count: sessions("product_view") },
      { step: "Added to cart", count: sessions("add_to_cart") },
      { step: "Started checkout", count: sessions("checkout_start") },
      { step: "Paid", count: orders },
    ],
    topProducts: top.map((r) => ({
      productId: r.productId,
      title: r.title,
      units: Number(r.units),
      salesMinor: Number(r.sales),
      views: Number(views.find((v) => v.productId === r.productId)?.views ?? 0),
    })),
    // A visitor counts once per site that sent them; the rest came direct.
    sources: withDirect(sources.map((s) => ({ source: s.source!, visitors: Number(s.visitors) })), visitors - Number(referred?.n ?? 0)),
  };
}

function withDirect(list: { source: string; visitors: number }[], direct: number) {
  return (direct > 0 ? [...list, { source: "Direct", visitors: direct }] : list).sort((a, b) => b.visitors - a.visitors);
}

/** Deletes visitor events older than about 13 months, so the table doesn't grow forever. */
export async function pruneEvents(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - 400 * DAY);
  const gone = await db.delete(schema.storefrontEvents).where(lt(schema.storefrontEvents.createdAt, cutoff)).returning({ id: schema.storefrontEvents.id });
  return gone.length;
}

