// Changing the day: a buyer who picked a day to collect their order, or to have it delivered,
// can move it from their order page until the day before, to another day the store hands over
// orders. The store's team is emailed, and the change shows in the order's history.
import { and, eq } from "drizzle-orm";
import { schema, type Db, type OrderEdit } from "@sf/db";
import type { Mailer } from "./email";
import { NotFoundError, UserError } from "./errors";
import { deliverOrderEmail, type FulfillmentContext } from "./fulfillment";
import { formatHandoverDay, handoverDates, HANDOVER_DAYS_AHEAD } from "./handover-days";
import { can } from "./team";

type Order = typeof schema.orders.$inferSelect;
type Shop = typeof schema.shops.$inferSelect;

function dayIn(timeZone: string, at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The days a buyer can move their pickup or delivery to, or null when it can't be changed online (handed over, unpaid, or the day is today or past). */
export function handoverDayOptions(shop: Pick<Shop, "handoverDays">, order: Pick<Order, "handoverOn" | "paymentStatus" | "fulfillmentStatus">, now = new Date()) {
  if (!shop.handoverDays || !order.handoverOn) return null;
  if (order.fulfillmentStatus === "delivered" || (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded")) return null;
  if (order.handoverOn <= dayIn(shop.handoverDays.timeZone, now)) return null;
  return handoverDates(shop.handoverDays, now);
}

export async function changeHandoverDay(ctx: { db: Db; mailer: Mailer; now?: () => Date; adminUrl: (path: string) => string }, shopId: string, orderId: string, day: string) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const [row] = await db
    .select({ order: schema.orders, shop: schema.shops })
    .from(schema.orders)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)));
  if (!row) throw new NotFoundError("Order");
  const { order, shop } = row;
  const options = handoverDayOptions(shop, order, now);
  if (!options) throw new UserError("The day can't be changed online any more. Message the store below and they'll help.", "too_late");
  if (!options.includes(day)) throw new UserError("Pick one of the days listed.");
  if (day === order.handoverOn) return order;
  const what = order.pickup ? "Pickup day" : "Delivery day";
  const from = formatHandoverDay(order.handoverOn!);
  const to = formatHandoverDay(day);
  const edit: OrderEdit = { at: now.toISOString(), by: "buyer", changes: [`${what} moved from ${from} to ${to}`] };
  const [updated] = await db
    .update(schema.orders)
    .set({ handoverOn: day, edits: [...order.edits, edit], updatedAt: now })
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.handoverOn, order.handoverOn!)))
    .returning();
  if (!updated) throw new UserError("The day was just changed. Reload the page to see it.");
  const people = await db
    .select({ email: schema.users.email, role: schema.shopMembers.role })
    .from(schema.shopMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
    .where(eq(schema.shopMembers.shopId, shopId));
  for (const p of people.filter((x) => can(x.role, "orders"))) {
    await ctx.mailer.send({
      to: p.email,
      subject: `Order #${order.number} at ${shop.name}: ${order.pickup ? "now collecting" : "now delivering"} on ${to}`,
      text: [
        "Hi,",
        "",
        order.pickup
          ? `The buyer of order #${order.number} moved their pickup from ${from} to ${to}.`
          : `The buyer of order #${order.number} moved their delivery from ${from} to ${to}.`,
        "",
        ctx.adminUrl(`/admin/orders/${order.id}`),
      ].join("\n"),
    });
  }
  return updated!;
}

/**
 * The days the store can move a pickup or delivery to: any day from today through the end of the
 * buyer's window, open or not, since the store knows when it can make an exception. Null when the
 * order can't move (no day, unpaid, or already handed over).
 */
export function storeHandoverOptions(shop: Pick<Shop, "handoverDays">, order: Pick<Order, "handoverOn" | "paymentStatus" | "fulfillmentStatus">, now = new Date()) {
  if (!shop.handoverDays || !order.handoverOn) return null;
  if (order.fulfillmentStatus === "delivered" || (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded")) return null;
  const start = Date.parse(`${dayIn(shop.handoverDays.timeZone, now)}T12:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < shop.handoverDays.leadDays + HANDOVER_DAYS_AHEAD; i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** The store moves a pickup or delivery to another day, and the buyer is emailed the new day. */
export async function moveHandoverDay(ctx: FulfillmentContext, shopId: string, orderId: string, day: string) {
  const { db } = ctx;
  const now = ctx.now?.() ?? new Date();
  const [row] = await db
    .select({ order: schema.orders, shop: schema.shops })
    .from(schema.orders)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)));
  if (!row) throw new NotFoundError("Order");
  const { order, shop } = row;
  const options = storeHandoverOptions(shop, order, now);
  if (!options) throw new UserError("This order has no day to move.");
  if (!options.includes(day)) throw new UserError("Pick one of the days listed.");
  if (day === order.handoverOn) return order;
  const from = formatHandoverDay(order.handoverOn!);
  const to = formatHandoverDay(day);
  const edit: OrderEdit = { at: now.toISOString(), by: "merchant", changes: [`${order.pickup ? "Pickup day" : "Delivery day"} moved from ${from} to ${to}`] };
  const [updated] = await db
    .update(schema.orders)
    .set({ handoverOn: day, edits: [...order.edits, edit], updatedAt: now })
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.handoverOn, order.handoverOn!)))
    .returning();
  if (!updated) throw new UserError("The day was just changed. Reload the page to see it.");
  const first = order.shippingAddress.name.split(" ")[0];
  await deliverOrderEmail(ctx, shop, updated, "handover_moved", day, {
    to: order.email,
    subject: order.pickup ? `New pickup day for order #${order.number} from ${shop.name}: ${to}` : `New delivery day for order #${order.number} from ${shop.name}: ${to}`,
    text: [
      `Hi ${first},`,
      ``,
      order.pickup
        ? `${shop.name} moved the day you collect order #${order.number} from ${from} to ${to}.`
        : `${shop.name} moved the delivery of order #${order.number} from ${from} to ${to}.`,
      ``,
      `Your order: ${await ctx.orderStatusUrl(shop, updated)}`,
      ``,
      `If the new day doesn't work for you, reply to this email.`,
    ].join("\n"),
  });
  return updated;
}
