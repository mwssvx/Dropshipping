// Store analytics: what visitors did (storefront_events) and what they bought (orders).
import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { schema, STOREFRONT_EVENTS, type Db, type StorefrontEventKind } from "@sf/db";
import { pruneSearchTerms } from "./search-terms";

const PAID = ["paid", "partially_refunded", "refunded"] as const;
const DAY = 86_400_000;

/** Keeps one visitor action. Bad input is dropped quietly: this runs on every page view. */
export async function recordEvent(
  db: Db,
  shopId: string,
  input: { sessionId: string; kind: string; productId?: string | null; postId?: string | null; referrer?: string | null; host?: string | null; utmSource?: string | null },
) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.sessionId)) return false;
  if (!(STOREFRONT_EVENTS as readonly string[]).includes(input.kind)) return false;
  const productId = input.productId && /^[0-9a-f-]{36}$/i.test(input.productId) ? input.productId : null;
  if (productId) {
    const p = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)), columns: { id: true } });
    if (!p) return false;
  }
  // A post read names its post, and only a post of this store.
  const postId = input.kind === "post_view" && input.postId && /^[0-9a-f-]{36}$/i.test(input.postId) ? input.postId : null;
  if (input.kind === "post_view") {
    if (!postId) return false;
    const p = await db.query.blogPosts.findFirst({ where: and(eq(schema.blogPosts.id, postId), eq(schema.blogPosts.shopId, shopId)), columns: { id: true } });
    if (!p) return false;
  }
  await db.insert(schema.storefrontEvents).values({ shopId, sessionId: input.sessionId, kind: input.kind as StorefrontEventKind, productId, postId, source: utmSourceOf(input.utmSource) ?? sourceOf(input.referrer, input.host) });
  return true;
}

/** The last blog post read in a visit, so an order placed in it counts toward that post. */
export async function visitPost(db: Db, shopId: string, sessionId: string | null | undefined) {
  if (!sessionId || !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return null;
  const e = schema.storefrontEvents;
  const [row] = await db
    .select({ postId: e.postId })
    .from(e)
    .where(and(eq(e.shopId, shopId), eq(e.sessionId, sessionId), eq(e.kind, "post_view"), isNotNull(e.postId)))
    .orderBy(desc(e.createdAt))
    .limit(1);
  return row?.postId ?? null;
}

/**
 * How each post did over the last `days`: visits that read it, and the paid orders (with their
 * sales after refunds) placed in a visit whose last post read was it.
 */
export async function postStats(db: Db, shopId: string, postIds: string[], days = 30, now = new Date()) {
  const stats = new Map<string, { reads: number; orders: number; salesMinor: number }>(postIds.map((id) => [id, { reads: 0, orders: 0, salesMinor: 0 }]));
  if (!postIds.length) return stats;
  const since = new Date(now.getTime() - days * DAY);
  const e = schema.storefrontEvents;
  const o = schema.orders;
  const [reads, sales] = await Promise.all([
    db
      .select({ postId: e.postId, reads: countDistinct(e.sessionId) })
      .from(e)
      .where(and(eq(e.shopId, shopId), eq(e.kind, "post_view"), inArray(e.postId, postIds), gte(e.createdAt, since)))
      .groupBy(e.postId),
    db
      .select({ postId: o.visitPostId, orders: count(), salesMinor: sql<number>`sum(${o.totalMinor} - ${o.refundedMinor})::bigint` })
      .from(o)
      .where(and(eq(o.shopId, shopId), inArray(o.visitPostId, postIds), inArray(o.paymentStatus, [...PAID]), ne(o.source, "replacement"), gte(o.createdAt, since)))
      .groupBy(o.visitPostId),
  ]);
  for (const r of reads) if (r.postId) stats.get(r.postId)!.reads = Number(r.reads);
  for (const r of sales) if (r.postId) Object.assign(stats.get(r.postId)!, { orders: Number(r.orders), salesMinor: Number(r.salesMinor) });
  return stats;
}

/** A link's utm_source ("instagram", "spring-newsletter"), cleaned up, or null when there's none worth keeping. */
export function utmSourceOf(value: string | null | undefined) {
  const clean = value?.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9._-]/g, "").slice(0, 50);
  return clean || null;
}

/** Where a visit came from: the first source it recorded, or null when it came direct. */
export async function visitSource(db: Db, shopId: string, sessionId: string | null | undefined) {
  if (!sessionId || !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return null;
  const e = schema.storefrontEvents;
  const [row] = await db
    .select({ source: e.source })
    .from(e)
    .where(and(eq(e.shopId, shopId), eq(e.sessionId, sessionId), isNotNull(e.source)))
    .orderBy(asc(e.createdAt))
    .limit(1);
  return row?.source ?? null;
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

export type Comparison = "previous" | "year";

/** The period to compare a range with: the same number of days just before it, or the same days a year earlier. */
export function comparisonRange(range: AnalyticsRange, kind: Comparison): AnalyticsRange {
  if (kind === "previous") {
    const length = range.to.getTime() - range.from.getTime();
    return { from: new Date(range.from.getTime() - length), to: new Date(range.from) };
  }
  const yearBack = (d: Date) => {
    const t = new Date(d);
    t.setUTCFullYear(t.getUTCFullYear() - 1);
    return t;
  };
  return { from: yearBack(range.from), to: yearBack(range.to) };
}

/**
 * Sales after refunds, orders and visitors in a range, counted the same way as the report, for
 * comparing two periods. Visitors (and so conversion) are null when the range starts before visitor
 * events are kept, since part of them is gone.
 */
export async function periodTotals(db: Db, shopId: string, range: AnalyticsRange, now = new Date()) {
  const o = schema.orders;
  const e = schema.storefrontEvents;
  const [[sales], [visits]] = await Promise.all([
    db
      .select({ sales: sql<number>`coalesce(sum(${o.totalMinor} - ${o.refundedMinor}), 0)::bigint`, orders: count() })
      .from(o)
      .where(and(eq(o.shopId, shopId), inArray(o.paymentStatus, [...PAID]), ne(o.source, "replacement"), gte(o.paidAt, range.from), lt(o.paidAt, range.to))),
    db.select({ n: countDistinct(e.sessionId) }).from(e).where(and(eq(e.shopId, shopId), gte(e.createdAt, range.from), lt(e.createdAt, range.to))),
  ]);
  const salesMinor = Number(sales?.sales ?? 0);
  const orders = Number(sales?.orders ?? 0);
  const kept = range.from.getTime() >= now.getTime() - EVENTS_KEPT_DAYS * DAY;
  const visitors = kept ? Number(visits?.n ?? 0) : null;
  return { salesMinor, orders, averageOrderMinor: orders ? Math.round(salesMinor / orders) : 0, visitors, conversion: visitors ? Math.min(1, orders / visitors) : null };
}

/** The change from `before` to `now` as a fraction (0.18 is 18% up), or null when there was nothing before to compare with. */
export const periodChange = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
/** The day in three-hour stretches, by their starting hour. */
export const DAY_PARTS = ["12–3 am", "3–6 am", "6–9 am", "9 am–12 pm", "12–3 pm", "3–6 pm", "6–9 pm", "9 pm–12 am"] as const;
/** Below this many orders the busiest time would be chance. */
export const BUSIEST_MIN_ORDERS = 10;

/**
 * When orders come in, in the store's time zone: by day of the week, by three-hour stretch of the
 * day, and the busiest stretch of the week once there are enough orders to say. Helps pick when to
 * send a campaign or start an ad.
 */
export async function whenBuyersBuy(db: Db, shopId: string, range: AnalyticsRange, timeZone: string) {
  let zone = "UTC";
  try {
    zone = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    // An unknown zone counts in UTC rather than failing the page.
  }
  const o = schema.orders;
  const local = sql`(${o.paidAt} at time zone ${zone})`;
  const dow = sql<number>`extract(isodow from ${local})::int`;
  const part = sql<number>`(extract(hour from ${local})::int / 3)`;
  const rows = await db
    .select({ dow, part, orders: count() })
    .from(o)
    .where(and(eq(o.shopId, shopId), inArray(o.paymentStatus, [...PAID]), ne(o.source, "replacement"), gte(o.paidAt, range.from), lt(o.paidAt, range.to)))
    // By position: the zone is a parameter each time, so Postgres can't match the expressions.
    .groupBy(sql`1`, sql`2`);
  const grid = WEEKDAYS.map(() => DAY_PARTS.map(() => 0));
  for (const r of rows) grid[Number(r.dow) - 1]![Number(r.part)]! += Number(r.orders);
  const orders = grid.flat().reduce((a, b) => a + b, 0);
  let busiest: { day: (typeof WEEKDAYS)[number]; part: (typeof DAY_PARTS)[number]; orders: number } | null = null;
  if (orders >= BUSIEST_MIN_ORDERS) {
    for (let d = 0; d < WEEKDAYS.length; d++) {
      for (let p = 0; p < DAY_PARTS.length; p++) {
        const n = grid[d]![p]!;
        if (n > (busiest?.orders ?? 0)) busiest = { day: WEEKDAYS[d]!, part: DAY_PARTS[p]!, orders: n };
      }
    }
  }
  return {
    timeZone: zone,
    orders,
    byDay: WEEKDAYS.map((day, d) => ({ day, orders: grid[d]!.reduce((a, b) => a + b, 0) })),
    byPart: DAY_PARTS.map((part, p) => ({ part, orders: grid.reduce((a, parts) => a + parts[p]!, 0) })),
    busiest,
  };
}

/** How long a first-time buyer has to order again to count as coming back. */
export const COME_BACK_DAYS = 90;

/**
 * Buyers who come back: for each month, how many people bought for the first time, and how many of
 * them ordered again within 90 days. A month less than 90 days old is still filling in, so it says so.
 * Buyers are told apart by email, in any case. Free replacements aren't orders.
 */
export async function repeatBuyers(db: Db, shopId: string, opts: { months?: number; now?: Date } = {}) {
  const months = opts.months ?? 6;
  const now = opts.now ?? new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const o = schema.orders;
  const buyers = db
    .select({ first: sql<Date>`min(${o.paidAt})`.as("first"), second: sql<Date | null>`(array_agg(${o.paidAt} order by ${o.paidAt}))[2]`.as("second") })
    .from(o)
    .where(and(eq(o.shopId, shopId), inArray(o.paymentStatus, [...PAID]), ne(o.source, "replacement"), isNotNull(o.paidAt)))
    .groupBy(sql`lower(${o.email})`)
    .having(sql`min(${o.paidAt}) >= ${since}`)
    .as("b");
  const back = sql`${buyers.second} < ${buyers.first} + make_interval(days => ${COME_BACK_DAYS})`;
  const rows = await db
    .select({
      month: sql<string>`to_char(${buyers.first} at time zone 'UTC', 'YYYY-MM')`,
      buyers: count(),
      cameBack: sql<number>`(count(*) filter (where ${back}))::int`,
      days: sql<number | null>`avg(extract(epoch from ${buyers.second} - ${buyers.first}) / 86400) filter (where ${back})`,
    })
    .from(buyers)
    .groupBy(sql`1`);

  const list = Array.from({ length: months }, (_, i) => {
    const start = Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i, 1);
    const month = new Date(start).toISOString().slice(0, 7);
    const end = Date.UTC(since.getUTCFullYear(), since.getUTCMonth() + i + 1, 1);
    const r = rows.find((x) => x.month === month);
    const n = Number(r?.buyers ?? 0);
    const cameBack = Number(r?.cameBack ?? 0);
    // Everyone who first bought that month has had their full 90 days.
    return { month, buyers: n, cameBack, share: n ? cameBack / n : null, complete: end + COME_BACK_DAYS * DAY <= now.getTime() };
  });
  const done = list.filter((m) => m.complete);
  const doneBuyers = done.reduce((a, m) => a + m.buyers, 0);
  const doneBack = done.reduce((a, m) => a + m.cameBack, 0);
  const backRows = rows.filter((r) => Number(r.cameBack) > 0);
  const backTotal = backRows.reduce((a, r) => a + Number(r.cameBack), 0);
  return {
    months: list,
    // Over the months that have had their full 90 days.
    share: doneBuyers ? doneBack / doneBuyers : null,
    averageDays: backTotal ? Math.round(backRows.reduce((a, r) => a + Number(r.days ?? 0) * Number(r.cameBack), 0) / backTotal) : null,
  };
}

/** Sales by day, the visitor funnel, best sellers and where visitors came from. `to` is exclusive. */
export async function analyticsReport(db: Db, shopId: string, range: AnalyticsRange) {
  const inRange = (col: typeof schema.orders.paidAt | typeof schema.storefrontEvents.createdAt) => and(gte(col, range.from), lt(col, range.to));
  // Free replacements aren't sales: they'd count the same goods twice.
  const paid = and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), ne(schema.orders.source, "replacement"), inRange(schema.orders.paidAt));
  const events = and(eq(schema.storefrontEvents.shopId, shopId), inRange(schema.storefrontEvents.createdAt));
  const day = (col: unknown) => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD')`;

  const sourceOrDirect = sql<string>`coalesce(${schema.orders.visitSource}, 'Direct')`;
  const [salesByDay, visitorsByDay, funnelRows, [visitorRow], top, views, sources, [referred], salesBySource] = await Promise.all([
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
    db
      .select({ source: sourceOrDirect, orders: count(), sales: sql<number>`sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor})::bigint` })
      .from(schema.orders)
      .where(paid)
      .groupBy(sourceOrDirect)
      .orderBy(desc(sql`3`))
      .limit(8),
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
    // What each source's buyers paid, after refunds: the visit an order came from, or Direct.
    salesBySource: salesBySource.map((s) => ({ source: s.source, orders: Number(s.orders), salesMinor: Number(s.sales) })),
  };
}

function withDirect(list: { source: string; visitors: number }[], direct: number) {
  return (direct > 0 ? [...list, { source: "Direct", visitors: direct }] : list).sort((a, b) => b.visitors - a.visitors);
}

/** How long visitor events are kept. */
export const EVENTS_KEPT_DAYS = 400;

/** Deletes visitor events and search counts older than about 13 months, so the tables don't grow forever. */
export async function pruneEvents(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - EVENTS_KEPT_DAYS * DAY);
  const gone = await db.delete(schema.storefrontEvents).where(lt(schema.storefrontEvents.createdAt, cutoff)).returning({ id: schema.storefrontEvents.id });
  return gone.length + (await pruneSearchTerms(db, now));
}

