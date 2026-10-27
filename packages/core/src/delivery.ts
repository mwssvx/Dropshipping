// Delivery dates: "Arrives Oct 18 – Oct 25" on product pages, order pages and receipts. The window
// is the store's processing days, then days in transit. Transit is the slower of the supplier's own
// estimate and the shipping rate's, so a store never promises faster than its supplier ships.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db, type ShipCutoff } from "@sf/db";
import { z } from "zod";
import { UserError } from "./errors";
import { nextCutoff, shipDay } from "./ship-cutoff";
import { fitsWeight, listShippingZones, zoneFor, type Rate } from "./shipping";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

const DAY = 86_400_000;

export type DeliveryWindow = { processingDays: number; transitMin: number; transitMax: number; from: Date; to: Date };

/**
 * The window for an order placed (or shipped, with no processing left) at `start`. With a same-day
 * cutoff, it counts from the shipping day the order makes, in the store's time zone.
 */
export function deliveryWindow(start: Date, processingDays: number, transitMin: number, transitMax: number, cutoff?: ShipCutoff | null): DeliveryWindow {
  if (cutoff) {
    const leaves = shipDay(start, processingDays, cutoff).getTime();
    return { processingDays, transitMin, transitMax, from: new Date(leaves + transitMin * DAY), to: new Date(leaves + transitMax * DAY) };
  }
  return {
    processingDays,
    transitMin,
    transitMax,
    from: new Date(start.getTime() + (processingDays + transitMin) * DAY),
    to: new Date(start.getTime() + (processingDays + transitMax) * DAY),
  };
}

type ShipDays = { shipDaysMin: number | null; shipDaysMax: number | null };

/** Days in transit: the slower of what the suppliers say and what the rate says, or null when neither says. */
export function transitDays(variants: ShipDays[], rate: Pick<Rate, "minDays" | "maxDays"> | null) {
  const known = variants.filter((v) => v.shipDaysMax !== null);
  const supplier = known.length
    ? { min: Math.max(...known.map((v) => v.shipDaysMin ?? v.shipDaysMax!)), max: Math.max(...known.map((v) => v.shipDaysMax!)) }
    : null;
  const promised = rate && rate.minDays !== null && rate.maxDays !== null ? { min: rate.minDays, max: rate.maxDays } : null;
  if (supplier && promised) return { min: Math.max(supplier.min, promised.min), max: Math.max(supplier.max, promised.max) };
  return supplier ?? promised;
}

const settingsInput = z.object({
  enabled: z.boolean(),
  processingDays: z
    .number({ error: "Enter the processing days as a whole number." })
    .int("Enter the processing days as a whole number.")
    .min(0, "Processing time is between 0 and 14 days.")
    .max(14, "Processing time is between 0 and 14 days."),
});

/** Turns delivery dates on or off and sets the days before an order leaves the supplier. */
export async function setDeliveryEstimates(db: Db, shopId: string, input: z.input<typeof settingsInput>) {
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  await db.update(schema.shops).set({ deliveryEstimates: parsed.data.enabled, processingDays: parsed.data.processingDays }).where(eq(schema.shops.id, shopId));
  return parsed.data;
}

/** The zone's rates for a country, falling back to the store's own country when it doesn't ship there. */
async function ratesFor(db: Db, shop: Shop, country: string | null) {
  const { zones } = await listShippingZones(db, shop.id);
  const wanted = country && zoneFor(zones, country)?.rates.length ? country : shop.country;
  return { country: wanted, rates: zoneFor(zones, wanted)?.rates ?? [] };
}

const cheapest = (rates: Rate[]) => [...rates].sort((a, b) => a.priceMinor - b.priceMinor)[0] ?? null;

/**
 * When a product would arrive if bought now, with the cheapest rate to the buyer's country (or the
 * store's, when it doesn't ship to theirs). Null when the store has dates off or nothing says how long.
 */
export async function productDelivery(db: Db, shop: Shop, productId: string, opts: { country?: string | null; now?: Date } = {}) {
  if (!shop.deliveryEstimates) return null;
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shop.id)), columns: { giftCard: true, digital: true } });
  if (!product || product.giftCard || product.digital) return null;
  const { country, rates } = await ratesFor(db, shop, opts.country ?? null);
  if (!rates.length) return null;
  const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, productId), columns: { shipDaysMin: true, shipDaysMax: true } });
  const transit = transitDays(variants, cheapest(rates));
  if (!transit) return null;
  const now = opts.now ?? new Date();
  // The countdown shows once the cutoff is less than a day away.
  const next = shop.shipCutoff ? nextCutoff(now, shop.processingDays, shop.shipCutoff) : null;
  const cutoff = next && next.msLeft <= DAY ? next : null;
  return { ...deliveryWindow(now, shop.processingDays, transit.min, transit.max, shop.shipCutoff), country, cutoff };
}

/**
 * When a paid order should arrive, with the rate the buyer picked. Once it has shipped, the window
 * counts from the latest shipment instead. Null when it's delivered, refunded, picked up in person, delivered by the store itself or has nothing to ship.
 */
export async function orderDelivery(db: Db, shop: Shop, order: Order) {
  if (!shop.deliveryEstimates || !order.paidAt || order.pickup || order.localDelivery || order.paymentStatus === "refunded" || order.fulfillmentStatus === "delivered") return null;
  const lines = await db
    .select({ shipDaysMin: schema.variants.shipDaysMin, shipDaysMax: schema.variants.shipDaysMax, giftCard: schema.products.giftCard, digital: schema.products.digital })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, order.id));
  const goods = lines.filter((l) => !l.giftCard && !l.digital);
  if (!goods.length) return null;
  const { rates } = await ratesFor(db, shop, order.shippingAddress.country);
  const rate = rates.find((r) => r.name === order.shippingMethod) ?? cheapest(rates);
  const transit = transitDays(goods, rate);
  if (!transit) return null;
  const shipped = await db.query.fulfillments.findMany({ where: and(eq(schema.fulfillments.orderId, order.id), inArray(schema.fulfillments.status, ["shipped", "delivered"])), columns: { shippedAt: true } });
  const lastShipped = shipped.map((f) => f.shippedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  // Fully shipped: only transit is left. Otherwise count from payment.
  const allShipped = order.fulfillmentStatus === "shipped" && lastShipped > 0;
  if (allShipped) return deliveryWindow(new Date(lastShipped), 0, transit.min, transit.max);
  // A pre-order waiting for stock is counted from the date it's promised to ship by.
  if (order.preorderShipsBy && order.fulfillmentStatus === "unfulfilled") return deliveryWindow(order.preorderShipsBy, 0, transit.min, transit.max);
  return deliveryWindow(order.paidAt, shop.processingDays, transit.min, transit.max, shop.shipCutoff);
}

const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "Oct 18 – Oct 25", in English, for emails. */
export const formatDeliveryWindow = (w: Pick<DeliveryWindow, "from" | "to">, format: (d: Date) => string = (d) => short.format(d)) =>
  w.from.getTime() === w.to.getTime() ? format(w.from) : `${format(w.from)} – ${format(w.to)}`;

/**
 * What shipping one of this item costs to the buyer's country, for the product page, so it isn't a
 * surprise at checkout: the cheapest rate that takes its weight (free when the item alone reaches
 * a rate's free-over amount), and the lowest amount that makes shipping free. Null when the store
 * doesn't ship there or it's a gift card.
 */
export async function productShipping(db: Db, shop: Shop, item: { priceMinor: number; weightGrams: number | null; giftCard?: boolean }, country: string | null) {
  if (item.giftCard) return null;
  const { zones } = await listShippingZones(db, shop.id);
  const to = country ?? shop.country;
  const rates = (zoneFor(zones, to)?.rates ?? []).filter((r) => fitsWeight(r, item.weightGrams ?? 0));
  if (!rates.length) return null;
  const price = (r: Rate) => (r.freeOverMinor !== null && item.priceMinor >= r.freeOverMinor ? 0 : r.priceMinor);
  const priceMinor = Math.min(...rates.map(price));
  const over = rates.map((r) => r.freeOverMinor).filter((m): m is number => m !== null);
  return { country: to, priceMinor, freeOverMinor: priceMinor > 0 && over.length ? Math.min(...over) : null };
}
