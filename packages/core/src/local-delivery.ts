// Local delivery. A store with its own stock can drop orders off itself to buyers nearby, for its
// own fee, instead of using a courier. The store lists the postal codes it covers by how they start
// ("787" covers 78701 to 78799, "SW1" covers SW1A 1AA), so it shows at checkout only once the buyer's
// postal code is in the area, and only when everything in the cart is the store's own stock. The
// merchant presses "Delivered" on the order when it's at the door.
import { and, eq, ne } from "drizzle-orm";
import { schema, type Db, type LocalDeliveryArea } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { refreshOrderFulfillment, sendOrderEmail, type FulfillmentContext } from "./fulfillment";

/** The rate id checkout uses for local delivery. */
export const LOCAL_DELIVERY_RATE_ID = "local_delivery";
/** What the order says it went by. */
export const LOCAL_DELIVERY_METHOD = "Local delivery";
export const MAX_DELIVERY_PREFIXES = 200;
export const MAX_DELIVERY_NOTE = 200;

/** Postal codes compared without spaces, dashes or case. */
export const postalKey = (code: string) => code.toUpperCase().replace(/[\s-]/g, "");

/** Whether a postal code is in the area. */
export function inDeliveryArea(area: Pick<LocalDeliveryArea, "postalPrefixes">, postalCode: string | null | undefined) {
  const key = postalKey(postalCode ?? "");
  return !!key && area.postalPrefixes.some((p) => key.startsWith(p));
}

/** What local delivery costs for goods worth this much. */
export function localDeliveryPrice(area: LocalDeliveryArea, goodsMinor: number) {
  return area.freeOverMinor !== null && goodsMinor >= area.freeOverMinor ? 0 : area.priceMinor;
}

/** Turns local delivery on with its area and price, or off (null). Prefixes come as typed: commas, spaces or lines. */
export async function setLocalDelivery(
  db: Db,
  shopId: string,
  input: { postalPrefixes: string | string[]; priceMinor: number; freeOverMinor?: number | null; note?: string | null } | null,
) {
  let value: LocalDeliveryArea | null = null;
  if (input) {
    const raw = Array.isArray(input.postalPrefixes) ? input.postalPrefixes : input.postalPrefixes.split(/[,;\n]+/);
    const postalPrefixes = [...new Set(raw.map(postalKey).filter(Boolean))].sort();
    if (!postalPrefixes.length) throw new UserError("Add the postal codes you deliver to, like 787 or SW1.");
    if (postalPrefixes.length > MAX_DELIVERY_PREFIXES) throw new UserError(`List up to ${MAX_DELIVERY_PREFIXES} postal codes. Shorter starts cover more.`);
    const bad = postalPrefixes.find((p) => !/^[A-Z0-9]{1,10}$/.test(p));
    if (bad) throw new UserError(`"${bad}" doesn't look like the start of a postal code.`);
    if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0 || input.priceMinor > 100_000) throw new UserError("Keep the delivery price between 0 and 1,000.");
    const freeOverMinor = input.freeOverMinor ?? null;
    if (freeOverMinor !== null && (!Number.isInteger(freeOverMinor) || freeOverMinor <= 0)) throw new UserError("Enter the order amount for free delivery, or leave it empty.");
    const note = (input.note ?? "").trim() || null;
    if (note && note.length > MAX_DELIVERY_NOTE) throw new UserError(`Keep the note under ${MAX_DELIVERY_NOTE} characters.`);
    value = { postalPrefixes, priceMinor: input.priceMinor, freeOverMinor, note };
  }
  await db.update(schema.shops).set({ localDeliveryArea: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/** The store dropped it off: the order is delivered and the buyer gets the delivered email. */
export async function markDeliveredByStore(ctx: FulfillmentContext, shopId: string, orderId: string) {
  const { db } = ctx;
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  if (!order.localDelivery) throw new UserError("This order goes by courier, so it's marked delivered from its tracking.");
  if (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded") throw new UserError("This order isn't paid.");
  if (order.heldAt) throw new UserError("This order is on hold for the risk check. Release or refund it first.");
  const t = ctx.now?.() ?? new Date();
  // Claimed first, so pressing twice records it once.
  const [claimed] = await db
    .update(schema.orders)
    .set({ fulfillmentStatus: "delivered", updatedAt: t })
    .where(and(eq(schema.orders.id, order.id), ne(schema.orders.fulfillmentStatus, "delivered")))
    .returning({ id: schema.orders.id });
  if (!claimed) throw new UserError("This order was already delivered.");
  await db.insert(schema.fulfillments).values({ shopId, orderId: order.id, supplierId: null, status: "delivered", carrier: LOCAL_DELIVERY_METHOD, shippedAt: t, deliveredAt: t, updatedAt: t });
  await refreshOrderFulfillment(db, order.id, t);
  await sendOrderEmail(ctx, order.id, "delivered");
}
