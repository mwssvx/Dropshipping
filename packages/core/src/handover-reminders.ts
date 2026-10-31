// The day before: a buyer who picked a day to collect their order, or to have it delivered by the
// store, gets one email the day before saying when and where, so fewer orders sit on the shelf and
// fewer drivers knock on an empty house. Runs with the "running late" emails, once per order.
import { and, eq, gte, inArray, isNotNull, lte, ne, notExists, sql } from "drizzle-orm";
import { schema } from "@sf/db";
import { deliverOrderEmail, type FulfillmentContext } from "./fulfillment";
import { formatHandoverDay } from "./handover-days";

/** Orders paid this recently aren't reminded: the buyer just picked the day. */
const FRESH_HOURS = 12;
const BATCH = 200;

function dayIn(timeZone: string, at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Emails buyers whose pickup or local delivery is tomorrow (store time), once per order. */
export async function sendHandoverReminders(ctx: FulfillmentContext, scope: { shopId?: string; limit?: number } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const o = schema.orders;
  // Tomorrow somewhere on Earth falls within a day either side of tomorrow in UTC; each store's own day is checked below.
  const utc = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const due = await db
    .select({ order: o, shop: schema.shops })
    .from(o)
    .innerJoin(schema.shops, eq(schema.shops.id, o.shopId))
    .where(
      and(
        scope.shopId ? eq(o.shopId, scope.shopId) : undefined,
        eq(schema.shops.status, "active"),
        isNotNull(schema.shops.handoverDays),
        isNotNull(o.handoverOn),
        gte(o.handoverOn, utc(0)),
        lte(o.handoverOn, utc(2)),
        inArray(o.paymentStatus, ["paid", "partially_refunded"]),
        ne(o.fulfillmentStatus, "delivered"),
        sql`${o.paidAt} <= ${now.toISOString()}::timestamptz - make_interval(hours => ${FRESH_HOURS})`,
        notExists(db.select({ id: schema.emails.id }).from(schema.emails).where(and(eq(schema.emails.orderId, o.id), eq(schema.emails.kind, "handover_reminder")))),
      ),
    )
    .orderBy(o.handoverOn)
    .limit(scope.limit ?? BATCH);
  let sent = 0;
  for (const { order, shop } of due) {
    const timeZone = shop.handoverDays!.timeZone;
    if (order.handoverOn !== dayIn(timeZone, new Date(now.getTime() + 86_400_000))) continue;
    const first = order.shippingAddress.name.split(" ")[0];
    const day = formatHandoverDay(order.handoverOn);
    const url = await ctx.orderStatusUrl(shop, order);
    const a = order.shippingAddress;
    const text = order.pickup
      ? [
          `Hi ${first},`,
          ``,
          `A reminder that you're collecting order #${order.number} tomorrow, ${day}, from:`,
          ``,
          shop.localPickup?.address ?? shop.name,
          ...(shop.localPickup?.instructions ? [``, shop.localPickup.instructions] : []),
          ``,
          `Your order: ${url}`,
          ``,
          `Can't make it? Reply to this email and we'll find another day.`,
        ]
      : [
          `Hi ${first},`,
          ``,
          `We're bringing order #${order.number} to you tomorrow, ${day}, at:`,
          ``,
          [a.line1, a.line2, a.city, a.postalCode].filter(Boolean).join(", "),
          ``,
          `Your order: ${url}`,
          ``,
          `Won't be in? Reply to this email and we'll find another day.`,
        ];
    const result = await deliverOrderEmail(ctx, shop, order, "handover_reminder", order.handoverOn, {
      to: order.email,
      subject: order.pickup ? `See you tomorrow: order #${order.number} from ${shop.name}` : `Your order #${order.number} from ${shop.name} arrives tomorrow`,
      text: text.join("\n"),
    });
    if (result.status === "sent") sent++;
  }
  return { sent };
}
