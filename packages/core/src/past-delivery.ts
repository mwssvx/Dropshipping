// Parcels that should have arrived by now: shipped orders past the last day of their delivery
// window and not marked delivered. These are the buyers about to write "where is my order?" or open
// a dispute, so the order list shows them before they do.
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { deliveryWindow, transitDays } from "./delivery";
import { listShippingZones, zoneFor } from "./shipping";

type Shop = typeof schema.shops.$inferSelect;

const DAY = 86_400_000;
/** Only orders paid this recently are looked at; older ones are long lost or long delivered. */
export const PAST_DELIVERY_LOOKBACK_DAYS = 120;
/** How many of the newest shipped orders are checked at most. */
const CANDIDATES = 400;

export type PastDeliveryOrder = {
  id: string;
  number: number;
  name: string;
  email: string;
  country: string;
  /** The last day it should have arrived by. */
  expected: Date;
  /** Whole days since then, at least 1. */
  daysLate: number;
  trackingUrl: string | null;
};

/**
 * Shipped orders whose delivery window ended at least a day ago, the latest first by how late. It
 * counts the same window buyers see on their order page (from the latest shipment, with the
 * supplier's and the rate's days), and works even when the store doesn't show dates to buyers.
 * Pickups, local deliveries, refunded orders and orders with nothing to ship are left out.
 */
export async function ordersPastDelivery(db: Db, shop: Shop, now = new Date()): Promise<PastDeliveryOrder[]> {
  const o = schema.orders;
  const shipped = await db.query.orders.findMany({
    where: and(eq(o.shopId, shop.id), eq(o.fulfillmentStatus, "shipped"), inArray(o.paymentStatus, ["paid", "partially_refunded"]), eq(o.pickup, false), eq(o.localDelivery, false), gte(o.paidAt, new Date(now.getTime() - PAST_DELIVERY_LOOKBACK_DAYS * DAY))),
    orderBy: desc(o.paidAt),
    limit: CANDIDATES,
  });
  if (!shipped.length) return [];
  const ids = shipped.map((s) => s.id);
  // One read each for every candidate, with the same count as the order page's window.
  const [lines, parcels, { zones }] = await Promise.all([
    db
      .select({ orderId: schema.orderLines.orderId, shipDaysMin: schema.variants.shipDaysMin, shipDaysMax: schema.variants.shipDaysMax, giftCard: schema.products.giftCard, digital: schema.products.digital })
      .from(schema.orderLines)
      .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
      .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
      .where(inArray(schema.orderLines.orderId, ids)),
    db.query.fulfillments.findMany({
      where: and(inArray(schema.fulfillments.orderId, ids), inArray(schema.fulfillments.status, ["shipped", "delivered"])),
      columns: { orderId: true, trackingUrl: true, shippedAt: true },
    }),
    listShippingZones(db, shop.id),
  ]);
  const ratesTo = (country: string) => zoneFor(zones, zoneFor(zones, country)?.rates.length ? country : shop.country)?.rates ?? [];
  const out: PastDeliveryOrder[] = [];
  for (const order of shipped) {
    const goods = lines.filter((l) => l.orderId === order.id && !l.giftCard && !l.digital);
    const latest = parcels.filter((p) => p.orderId === order.id && p.shippedAt).sort((a, b) => b.shippedAt!.getTime() - a.shippedAt!.getTime())[0];
    if (!goods.length || !latest) continue;
    const rates = ratesTo(order.shippingAddress.country);
    const rate = rates.find((r) => r.name === order.shippingMethod) ?? [...rates].sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? null;
    const transit = transitDays(goods, rate);
    if (!transit) continue;
    const window = deliveryWindow(latest.shippedAt!, 0, transit.min, transit.max);
    const late = Math.floor((now.getTime() - window.to.getTime()) / DAY);
    if (late < 1) continue;
    out.push({
      id: order.id,
      number: order.number,
      name: order.shippingAddress.name,
      email: order.email,
      country: order.shippingAddress.country,
      expected: window.to,
      daysLate: late,
      trackingUrl: latest.trackingUrl,
    });
  }
  return out.sort((a, b) => b.daysLate - a.daysLate || a.number - b.number);
}
