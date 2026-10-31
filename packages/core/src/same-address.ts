// Orders going to the same door. A buyer who comes back the next day for one more thing gets two
// orders, and when both hold something the store posts itself, that's two boxes and two postage
// costs for one doorstep. The admin order page lists the buyer's other orders to the same address
// that haven't shipped yet, so the merchant can pack the store's own items in one box.
import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { addressKey } from "./blocklist";
import { addManualTracking, type FulfillmentContext } from "./fulfillment";

const DAYS = 30;
const DAY = 86_400_000;

/** "12 Elm St." and "12 elm st" at the same postcode are the same door; a different flat isn't. */
export const doorKey = (a: Address) => `${addressKey(a) ?? ""}|${(a.line2 ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")}`;

export type SameAddressOrder = {
  id: string;
  number: number;
  createdAt: Date;
  fulfillmentStatus: (typeof schema.orders.$inferSelect)["fulfillmentStatus"];
  /** It has something the store posts itself that hasn't gone yet, so it can share a box. */
  ownItems: boolean;
};

/** Which of these orders still have own-shelf items to post. */
export async function ownItemsWaiting(db: Db, orderIds: string[]) {
  if (!orderIds.length) return new Set<string>();
  const rows = await db
    .selectDistinct({ orderId: schema.orderLines.orderId })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(inArray(schema.orderLines.orderId, orderIds), isNull(schema.products.supplierId), eq(schema.products.giftCard, false), eq(schema.products.digital, false)));
  const shipped = await db
    .select({ orderId: schema.fulfillments.orderId })
    .from(schema.fulfillments)
    .where(and(inArray(schema.fulfillments.orderId, orderIds), isNull(schema.fulfillments.supplierId), sql`${schema.fulfillments.trackingNumber} is not null`));
  const gone = new Set(shipped.map((r) => r.orderId));
  return new Set(rows.map((r) => r.orderId).filter((id) => !gone.has(id)));
}

const OPEN = ["unfulfilled", "sent_to_supplier", "partially_shipped"] as const;
type ListOrder = { id: string; number: number; createdAt: Date; shippingAddress: Address; pickup: boolean; localDelivery: boolean; paymentStatus: string; fulfillmentStatus: string };
const open = (o: ListOrder) => o.paymentStatus === "paid" && (OPEN as readonly string[]).includes(o.fulfillmentStatus) && !o.pickup && !o.localDelivery && !!addressKey(o.shippingAddress);

/**
 * For a page of the order list: the numbers of other unshipped orders going to the same door as
 * each one, so the list can say "Same address as #1001" while they can still share a box.
 */
export async function sameAddressOnList(db: Db, shopId: string, orders: ListOrder[]): Promise<Map<string, { id: string; number: number }[]>> {
  const shown = orders.filter(open);
  const result = new Map<string, { id: string; number: number }[]>();
  if (!shown.length) return result;
  const o = schema.orders;
  const times = shown.map((x) => x.createdAt.getTime());
  const countries = [...new Set(shown.map((x) => x.shippingAddress.country.toUpperCase()))];
  const candidates = await db
    .select({ id: o.id, number: o.number, createdAt: o.createdAt, shippingAddress: o.shippingAddress })
    .from(o)
    .where(
      and(
        eq(o.shopId, shopId),
        eq(o.paymentStatus, "paid"),
        inArray(o.fulfillmentStatus, [...OPEN]),
        eq(o.pickup, false),
        eq(o.localDelivery, false),
        gte(o.createdAt, new Date(Math.min(...times) - DAYS * DAY)),
        lte(o.createdAt, new Date(Math.max(...times) + DAYS * DAY)),
        inArray(sql`upper(${o.shippingAddress}->>'country')`, countries),
      ),
    )
    .orderBy(o.number)
    .limit(5000);
  const byDoor = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const key = doorKey(c.shippingAddress);
    byDoor.set(key, [...(byDoor.get(key) ?? []), c]);
  }
  for (const x of shown) {
    const others = (byDoor.get(doorKey(x.shippingAddress)) ?? []).filter((c) => c.id !== x.id && Math.abs(c.createdAt.getTime() - x.createdAt.getTime()) <= DAYS * DAY);
    if (others.length) result.set(x.id, others.map((c) => ({ id: c.id, number: c.number })));
  }
  return result;
}

/**
 * The store's other paid orders to the same address, placed within 30 days either side of this
 * one, that haven't all shipped. Pickups and local deliveries don't count: nothing is posted.
 */
export async function ordersToSameAddress(
  db: Db,
  shopId: string,
  order: { id: string; createdAt: Date; shippingAddress: Address; pickup: boolean; localDelivery: boolean },
): Promise<{ orders: SameAddressOrder[]; ownItems: boolean }> {
  if (order.pickup || order.localDelivery || !addressKey(order.shippingAddress)) return { orders: [], ownItems: false };
  const a = order.shippingAddress;
  const o = schema.orders;
  const candidates = await db
    .select({ id: o.id, number: o.number, createdAt: o.createdAt, fulfillmentStatus: o.fulfillmentStatus, shippingAddress: o.shippingAddress })
    .from(o)
    .where(
      and(
        eq(o.shopId, shopId),
        ne(o.id, order.id),
        eq(o.paymentStatus, "paid"),
        inArray(o.fulfillmentStatus, [...OPEN]),
        eq(o.pickup, false),
        eq(o.localDelivery, false),
        gte(o.createdAt, new Date(order.createdAt.getTime() - DAYS * DAY)),
        lte(o.createdAt, new Date(order.createdAt.getTime() + DAYS * DAY)),
        sql`upper(${o.shippingAddress}->>'country') = ${a.country.toUpperCase()}`,
      ),
    )
    .orderBy(o.createdAt)
    .limit(200);
  const key = doorKey(a);
  const same = candidates.filter((c) => doorKey(c.shippingAddress) === key);
  const own = await ownItemsWaiting(db, [order.id, ...same.map((c) => c.id)]);
  return {
    orders: same.map(({ shippingAddress: _, ...c }) => ({ ...c, ownItems: own.has(c.id) })),
    ownItems: own.has(order.id),
  };
}

/**
 * After posting the store's own items for one order, the same tracking for the other orders to
 * that door that were packed in the same box. Only orders that really share the door and still
 * wait on the store's own items get it. Returns their numbers.
 */
export async function addTrackingToSameBox(
  ctx: FulfillmentContext,
  shopId: string,
  orderId: string,
  alsoIds: string[],
  input: { carrier: string; trackingNumber: string; url?: string },
): Promise<number[]> {
  if (!alsoIds.length) return [];
  const order = await ctx.db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) return [];
  const { orders } = await ordersToSameAddress(ctx.db, shopId, order);
  const done: number[] = [];
  for (const other of orders.filter((o) => o.ownItems && alsoIds.includes(o.id))) {
    await addManualTracking(ctx, shopId, other.id, { ...input, own: true });
    done.push(other.number);
  }
  return done;
}
