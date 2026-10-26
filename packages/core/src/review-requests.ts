// Review requests: a few days after an order arrives, the buyer gets one email asking how it was,
// with a link to the review form on their order page. Once per order, never for gifts (the buyer
// didn't receive it) or free replacements, and never to buyers who unsubscribed from the store.
import { and, count, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import type { FulfillmentContext } from "./fulfillment";
import { reviewableItems } from "./reviews";

const DAY = 86_400_000;
/** Orders that arrived longer ago than this (on top of the wait) are never asked, so turning it on doesn't email old buyers. */
const LOOKBACK_DAYS = 30;
const BATCH = 200;

export async function setReviewRequestDays(db: Db, shopId: string, days: number) {
  if (!Number.isInteger(days) || days < 0 || days > 30) throw new UserError("Pick 1 to 30 days, or 0 to turn it off.");
  await db.update(schema.shops).set({ reviewRequestDays: days, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
}

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "there";

/** Emails the review requests that are due, for one store or all of them. Returns how many went out. */
export async function sendReviewRequests(ctx: FulfillmentContext, scope: { shopId?: string; limit?: number } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const o = schema.orders;
  const delivered = sql<Date>`(select max(${schema.fulfillments.deliveredAt}) from ${schema.fulfillments} where ${schema.fulfillments.orderId} = ${o.id})`;
  const due = await db
    .select({ order: o, shop: schema.shops })
    .from(o)
    .innerJoin(schema.shops, eq(schema.shops.id, o.shopId))
    .where(
      and(
        scope.shopId ? eq(o.shopId, scope.shopId) : undefined,
        eq(schema.shops.status, "active"),
        sql`${schema.shops.reviewRequestDays} > 0`,
        eq(o.fulfillmentStatus, "delivered"),
        inArray(o.paymentStatus, ["paid", "partially_refunded"]),
        ne(o.source, "replacement"),
        isNull(o.gift),
        isNull(o.reviewRequestedAt),
        sql`${delivered} <= ${now.toISOString()}::timestamptz - make_interval(days => ${schema.shops.reviewRequestDays})`,
        sql`${delivered} > ${now.toISOString()}::timestamptz - make_interval(days => ${schema.shops.reviewRequestDays} + ${LOOKBACK_DAYS})`,
      ),
    )
    .orderBy(o.createdAt)
    .limit(scope.limit ?? BATCH);
  let sent = 0;
  for (const { order, shop } of due) {
    // Claim first, so two runs at once can't ask twice.
    const [claimed] = await db.update(o).set({ reviewRequestedAt: now }).where(and(eq(o.id, order.id), isNull(o.reviewRequestedAt))).returning({ id: o.id });
    if (!claimed || !order.email || !order.paymentIntentId) continue;
    const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, order.email)) });
    if (customer?.unsubscribedAt) continue;
    const items = (await reviewableItems(db, shop.id, order.paymentIntentId)).filter((i) => !i.review);
    if (!items.length) continue;
    const link = `${await ctx.orderStatusUrl(shop, order)}#review`;
    const what = items.length === 1 ? items[0]!.title : `your order #${order.number}`;
    const base = ctx.storeAddress ? await ctx.storeAddress(shop) : new URL(link).origin;
    const unsubscribe = customer ? `${base}/unsubscribe/${customer.emailToken}` : null;
    await ctx.mailer.send({
      to: order.email,
      subject: `How was ${what}?`,
      text: [
        `Hi ${firstName(order.shippingAddress?.name)},`,
        ``,
        `Your order from ${shop.name} arrived a few days ago. How was it? A quick review, with a photo if you like, helps other buyers and means a lot to us.`,
        ``,
        ...items.slice(0, 5).map((i) => `- ${i.title}`),
        ``,
        `Leave a review: ${link}`,
        ``,
        `Something wrong with it? Reply from your order page and we'll sort it out.`,
        ...(unsubscribe ? [``, "—", `${shop.name}. One email per order. Don't want these? Unsubscribe: ${unsubscribe}`] : []),
      ].join("\n"),
      ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${unsubscribe}/one-click>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    });
    sent++;
  }
  return { sent };
}

/** For the Reviews page: requests sent in the last 30 days, and how many of those orders have a review. */
export async function reviewRequestStats(db: Db, shopId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY);
  const asked = and(eq(schema.orders.shopId, shopId), gte(schema.orders.reviewRequestedAt, since));
  const [sent] = await db.select({ n: count() }).from(schema.orders).where(asked);
  const [reviewed] = await db
    .select({ n: sql<number>`count(distinct ${schema.reviews.orderId})::int` })
    .from(schema.reviews)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.reviews.orderId))
    .where(asked);
  return { sent: Number(sent?.n ?? 0), reviewed: Number(reviewed?.n ?? 0) };
}
