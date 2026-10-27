// Local pickup. A store that keeps its own stock can let buyers in its country collect orders
// from its shop, studio or front door instead of paying for shipping. It shows at checkout next to
// the shipping rates, free, when everything in the cart is the store's own stock (supplier items
// ship from the supplier, so they can't be picked up). The merchant presses "Ready for pickup" when
// it's packed, which emails the buyer the address and instructions, then "Picked up" when the
// buyer has it, which marks the order delivered.
import { and, eq, isNull, ne } from "drizzle-orm";
import { schema, type Db, type LocalPickup } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { refreshOrderFulfillment, sendOrderEmail, type FulfillmentContext } from "./fulfillment";

/** The rate id checkout uses for picking up. */
export const PICKUP_RATE_ID = "pickup";
/** What the order says it went by. */
export const PICKUP_METHOD = "Local pickup";
export const MAX_PICKUP_ADDRESS = 300;
export const MAX_PICKUP_INSTRUCTIONS = 500;

const clean = (s: string | null | undefined) => (s ?? "").trim().replace(/\r\n/g, "\n");

/** Turns local pickup on with where and how, or off (null). */
export async function setLocalPickup(db: Db, shopId: string, input: { address: string; instructions?: string | null } | null) {
  let value: LocalPickup | null = null;
  if (input) {
    const address = clean(input.address);
    const instructions = clean(input.instructions) || null;
    if (!address) throw new UserError("Enter the address buyers pick up from.");
    if (address.length > MAX_PICKUP_ADDRESS) throw new UserError(`Keep the address under ${MAX_PICKUP_ADDRESS} characters.`);
    if (instructions && instructions.length > MAX_PICKUP_INSTRUCTIONS) throw new UserError(`Keep the instructions under ${MAX_PICKUP_INSTRUCTIONS} characters.`);
    value = { address, instructions };
  }
  await db.update(schema.shops).set({ localPickup: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/** None of these products come from a supplier: the store has them on its own shelf. */
export function ownStockOnly(products: { supplierId: string | null; sourceUrl: string | null }[]) {
  return products.length > 0 && products.every((p) => !p.supplierId && !p.sourceUrl);
}

/** Whether these products can be picked up: the store offers it and none of them come from a supplier. */
export function canPickUp(shop: { localPickup: LocalPickup | null }, products: { supplierId: string | null; sourceUrl: string | null }[]) {
  return !!shop.localPickup && ownStockOnly(products);
}

async function pickupOrder(db: Db, shopId: string, orderId: string) {
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  if (!order.pickup) throw new UserError("This order is being shipped, not picked up.");
  if (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded") throw new UserError("This order isn't paid.");
  if (order.heldAt) throw new UserError("This order is on hold for the risk check. Release or refund it first.");
  if (order.fulfillmentStatus === "delivered") throw new UserError("This order was already picked up.");
  return order;
}

/** The order is packed: the buyer is emailed where and how to pick it up, once. */
export async function markReadyForPickup(ctx: FulfillmentContext, shopId: string, orderId: string) {
  const order = await pickupOrder(ctx.db, shopId, orderId);
  const t = ctx.now?.() ?? new Date();
  const [ready] = await ctx.db
    .update(schema.orders)
    .set({ pickupReadyAt: t, updatedAt: t })
    .where(and(eq(schema.orders.id, order.id), isNull(schema.orders.pickupReadyAt)))
    .returning({ id: schema.orders.id });
  if (!ready) throw new UserError("The buyer was already told it's ready.");
  await sendOrderEmail(ctx, order.id, "pickup_ready");
}

/** The buyer has it: the order is delivered and the buyer gets the delivered email. */
export async function markPickedUp(ctx: FulfillmentContext, shopId: string, orderId: string) {
  const order = await pickupOrder(ctx.db, shopId, orderId);
  const t = ctx.now?.() ?? new Date();
  // Claimed first, so pressing twice records it once.
  const [claimed] = await ctx.db
    .update(schema.orders)
    .set({ fulfillmentStatus: "delivered", pickupReadyAt: order.pickupReadyAt ?? t, updatedAt: t })
    .where(and(eq(schema.orders.id, order.id), ne(schema.orders.fulfillmentStatus, "delivered")))
    .returning({ id: schema.orders.id });
  if (!claimed) throw new UserError("This order was already picked up.");
  await ctx.db.insert(schema.fulfillments).values({
    shopId,
    orderId: order.id,
    supplierId: null,
    status: "delivered",
    carrier: PICKUP_METHOD,
    shippedAt: t,
    deliveredAt: t,
    updatedAt: t,
  });
  await refreshOrderFulfillment(ctx.db, order.id, t);
  await sendOrderEmail(ctx, order.id, "delivered");
}
