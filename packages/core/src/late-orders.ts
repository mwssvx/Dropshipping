// Running late: a buyer whose order still hasn't shipped some days after paying gets one email
// saying it hasn't been forgotten, before they start to wonder, email to ask or open a dispute.
// The store picks after how many days, and can add a few words of its own. Orders on hold,
// pre-orders (they have their own date), local pickup and delivery, and orders already on their
// way are left alone, and nobody hears twice. Stores can also have buyers hear once when a shipped
// parcel is past its delivery date ("still on its way").
import { and, eq, inArray, isNull, ne, notExists, sql } from "drizzle-orm";
import { schema, type Db, type LateOrderNotice } from "@sf/db";
import { UserError } from "./errors";
import { deliverOrderEmail, type FulfillmentContext } from "./fulfillment";
import { sendHandoverReminders } from "./handover-reminders";
import { ordersPastDelivery } from "./past-delivery";

export const LATE_ORDER_DAYS = [3, 5, 7, 10, 14] as const;
export const LATE_ORDER_MESSAGE_MAX = 500;
/** Orders paid longer ago than this past their day don't get one, so turning it on doesn't email old orders. */
const LOOKBACK_DAYS = 14;
const BATCH = 200;

/** Shipped parcels this many days past their date or fewer get the "still on its way" email, so turning it on doesn't email old orders. */
export const TRANSIT_LATE_MAX_DAYS = 14;

/**
 * Turns "running late" emails on after `days` without shipping, with an optional message, or off
 * with null. With `transit`, buyers also hear once when a shipped parcel is past its delivery date.
 */
export async function setLateOrderNotice(db: Db, shopId: string, input: { days: number; message?: string | null; transit?: boolean } | null) {
  let value: LateOrderNotice | null = null;
  if (input) {
    if (!(LATE_ORDER_DAYS as readonly number[]).includes(input.days)) throw new UserError("Pick after how many days.");
    const message = input.message?.trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n") || null;
    if (message && message.length > LATE_ORDER_MESSAGE_MAX) throw new UserError(`Keep the message under ${LATE_ORDER_MESSAGE_MAX} characters.`);
    value = { days: input.days, message, ...(input.transit ? { transit: true } : {}) };
  }
  await db.update(schema.shops).set({ lateOrderNotice: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/** Emails the buyers of orders that haven't shipped in their store's number of days, once each. */
export async function sendLateOrderEmails(ctx: FulfillmentContext, scope: { shopId?: string; limit?: number } = {}) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const o = schema.orders;
  const days = sql`(${schema.shops.lateOrderNotice} ->> 'days')::int`;
  const at = sql`${now.toISOString()}::timestamptz`;
  const due = await db
    .select({ order: o, shop: schema.shops })
    .from(o)
    .innerJoin(schema.shops, eq(schema.shops.id, o.shopId))
    .where(
      and(
        scope.shopId ? eq(o.shopId, scope.shopId) : undefined,
        eq(schema.shops.status, "active"),
        sql`${schema.shops.lateOrderNotice} is not null`,
        inArray(o.paymentStatus, ["paid", "partially_refunded"]),
        inArray(o.fulfillmentStatus, ["unfulfilled", "sent_to_supplier", "problem"]),
        ne(o.source, "replacement"),
        isNull(o.heldAt),
        isNull(o.preorderShipsBy),
        eq(o.pickup, false),
        eq(o.localDelivery, false),
        sql`${o.paidAt} <= ${at} - make_interval(days => ${days})`,
        sql`${o.paidAt} > ${at} - make_interval(days => ${days} + ${LOOKBACK_DAYS})`,
        notExists(db.select({ id: schema.emails.id }).from(schema.emails).where(and(eq(schema.emails.orderId, o.id), eq(schema.emails.kind, "order_late")))),
      ),
    )
    .orderBy(o.paidAt)
    .limit(scope.limit ?? BATCH);
  let sent = 0;
  for (const { order, shop } of due) {
    const first = order.shippingAddress.name.split(" ")[0];
    const message = shop.lateOrderNotice?.message;
    const result = await deliverOrderEmail(ctx, shop, order, "order_late", "late", {
      to: order.email,
      subject: `Your order #${order.number} from ${shop.name} is taking a little longer`,
      text: [
        `Hi ${first},`,
        ``,
        `Your order #${order.number} is taking longer than we'd like to get on its way. It hasn't been forgotten: we're on it, and you'll get the tracking the moment it ships.`,
        ...(message ? [``, message] : []),
        ``,
        `Your order: ${await ctx.orderStatusUrl(shop, order)}`,
        ``,
        `If you have a question or would rather not wait, reply to this email and we'll help.`,
      ].join("\n"),
    });
    if (result.status === "sent") sent++;
  }
  const transit = await sendTransitLateEmails(ctx, scope);
  // The day-before pickup and delivery reminders run here too, so they need no job of their own.
  const handover = (await sendHandoverReminders(ctx, scope)).sent;
  return { sent, transit, handover };
}

/**
 * "Still on its way": once a shipped parcel is a day past the last day of its delivery window and
 * not marked delivered, the buyer gets one email with the tracking, for stores that turned it on.
 * Parcels more than two weeks past their date are left alone.
 */
async function sendTransitLateEmails(ctx: FulfillmentContext, scope: { shopId?: string; limit?: number }) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const shops = await db.query.shops.findMany({
    where: and(scope.shopId ? eq(schema.shops.id, scope.shopId) : undefined, eq(schema.shops.status, "active"), sql`(${schema.shops.lateOrderNotice} ->> 'transit')::boolean`),
  });
  let sent = 0;
  for (const shop of shops) {
    const late = (await ordersPastDelivery(db, shop, now)).filter((p) => p.daysLate <= TRANSIT_LATE_MAX_DAYS);
    if (!late.length) continue;
    const told = await db.query.emails.findMany({ where: and(inArray(schema.emails.orderId, late.map((p) => p.id)), eq(schema.emails.kind, "order_transit_late")), columns: { orderId: true } });
    const skip = new Set(told.map((e) => e.orderId));
    for (const parcel of late.filter((p) => !skip.has(p.id)).slice(0, scope.limit ?? BATCH)) {
      const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, parcel.id) });
      if (!order) continue;
      const first = order.shippingAddress.name.split(" ")[0];
      const message = shop.lateOrderNotice?.message;
      const result = await deliverOrderEmail(ctx, shop, order, "order_transit_late", "transit", {
        to: order.email,
        subject: `Your order #${order.number} from ${shop.name} is still on its way`,
        text: [
          `Hi ${first},`,
          ``,
          `Your order #${order.number} shipped, but it's taking longer to reach you than we said. Parcels are sometimes held up at customs or by the carrier, and most arrive within a few days of their date. We're keeping an eye on it.`,
          ...(parcel.trackingUrl ? [``, `Track it here: ${parcel.trackingUrl}`] : []),
          ...(message ? [``, message] : []),
          ``,
          `Your order: ${await ctx.orderStatusUrl(shop, order)}`,
          ``,
          `Already got it? Press "It arrived" on your order page. If it still hasn't arrived in a week, reply to this email and we'll sort it out.`,
        ].join("\n"),
      });
      if (result.status === "sent") sent++;
    }
  }
  return sent;
}
