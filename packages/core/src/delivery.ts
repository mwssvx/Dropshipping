// Delivery dates: "Arrives Oct 18 – Oct 25" on product pages, order pages and receipts. The window
// is the store's processing days, then days in transit. Transit is the slower of the supplier's own
// estimate and the shipping rate's, so a store never promises faster than its supplier ships.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { UserError } from "./errors";
import { listShippingZones, zoneFor, type Rate } from "./shipping";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

const DAY = 86_400_000;

export type DeliveryWindow = { processingDays: number; transitMin: number; transitMax: number; from: Date; to: Date };

/** The window for an order placed (or shipped, with no processing left) at `start`. */
export function deliveryWindow(start: Date, processingDays: number, transitMin: number, transitMax: number): DeliveryWindow {
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
    .number({ invalid_type_error: "Enter the processing days as a whole number." })
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
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shop.id)), columns: { giftCard: true } });
  if (!product || product.giftCard) return null;
  const { country, rates } = await ratesFor(db, shop, opts.country ?? null);
  if (!rates.length) return null;
  const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, productId), columns: { shipDaysMin: true, shipDaysMax: true } });
  const transit = transitDays(variants, cheapest(rates));
  if (!transit) return null;
  return { ...deliveryWindow(opts.now ?? new Date(), shop.processingDays, transit.min, transit.max), country };
}

/**
 * When a paid order should arrive, with the rate the buyer picked. Once it has shipped, the window
 * counts from the latest shipment instead. Null when it's delivered, refunded or has nothing to ship.
 */
export async function orderDelivery(db: Db, shop: Shop, order: Order) {
  if (!shop.deliveryEstimates || !order.paidAt || order.paymentStatus === "refunded" || order.fulfillmentStatus === "delivered") return null;
  const lines = await db
    .select({ shipDaysMin: schema.variants.shipDaysMin, shipDaysMax: schema.variants.shipDaysMax, giftCard: schema.products.giftCard })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, order.id));
  const goods = lines.filter((l) => !l.giftCard);
  if (!goods.length) return null;
  const { rates } = await ratesFor(db, shop, order.shippingAddress.country);
  const rate = rates.find((r) => r.name === order.shippingMethod) ?? cheapest(rates);
  const transit = transitDays(goods, rate);
  if (!transit) return null;
  const shipped = await db.query.fulfillments.findMany({ where: and(eq(schema.fulfillments.orderId, order.id), inArray(schema.fulfillments.status, ["shipped", "delivered"])), columns: { shippedAt: true } });
  const lastShipped = shipped.map((f) => f.shippedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  // Fully shipped: only transit is left. Otherwise count from payment.
  const allShipped = order.fulfillmentStatus === "shipped" && lastShipped > 0;
  return allShipped ? deliveryWindow(new Date(lastShipped), 0, transit.min, transit.max) : deliveryWindow(order.paidAt, shop.processingDays, transit.min, transit.max);
}

const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** "Oct 18 – Oct 25", in English, for emails. */
export const formatDeliveryWindow = (w: Pick<DeliveryWindow, "from" | "to">, format: (d: Date) => string = (d) => short.format(d)) =>
  w.from.getTime() === w.to.getTime() ? format(w.from) : `${format(w.from)} – ${format(w.to)}`;
