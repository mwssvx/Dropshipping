// The store's own stock goes down as it sells. Products the merchant added by hand keep their own
// count (imported products read theirs from the supplier every day instead). It comes off when an
// order is paid, goes back when a paid order is cancelled or fully refunded before anything has
// shipped, and follows a swap from one option to another before it ships. Pre-ordered lines were
// sold past the stock, so they don't take any, and stock never goes below 0. An option with no
// count ("Not tracked") is left alone.
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

/** Of these options, the ones counting the store's own stock. */
async function ownStockVariants(db: Db, variantIds: string[]) {
  if (!variantIds.length) return new Set<string>();
  const rows = await db
    .select({ id: schema.variants.id })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(inArray(schema.variants.id, variantIds), isNotNull(schema.variants.stock), isNull(schema.products.sourceUrl)));
  return new Set(rows.map((r) => r.id));
}

/** How many of each own-stock option the order holds. */
async function orderStock(db: Db, orderId: string) {
  const lines = await db.query.orderLines.findMany({ where: and(eq(schema.orderLines.orderId, orderId), eq(schema.orderLines.preorder, false)) });
  const own = await ownStockVariants(db, [...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v))]);
  const qty = new Map<string, number>();
  for (const l of lines) if (l.variantId && own.has(l.variantId)) qty.set(l.variantId, (qty.get(l.variantId) ?? 0) + l.quantity);
  return qty;
}

const change = (db: Db, variantId: string, by: number) =>
  db
    .update(schema.variants)
    .set({ stock: sql`greatest(${schema.variants.stock} + ${by}, 0)` })
    .where(and(eq(schema.variants.id, variantId), isNotNull(schema.variants.stock)));

/** A paid order takes its items off the store's own stock, once. */
export async function takeOrderStock(db: Db, orderId: string, at = new Date()) {
  const [claimed] = await db
    .update(schema.orders)
    .set({ stockTakenAt: at })
    .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.stockTakenAt)))
    .returning({ id: schema.orders.id });
  if (!claimed) return 0;
  const qty = await orderStock(db, orderId);
  for (const [variantId, n] of qty) await change(db, variantId, -n);
  return qty.size;
}

/** Nothing on the order will ship: its items go back on the shelf, once. */
export async function returnOrderStock(db: Db, orderId: string) {
  const [claimed] = await db
    .update(schema.orders)
    .set({ stockTakenAt: null })
    .where(and(eq(schema.orders.id, orderId), isNotNull(schema.orders.stockTakenAt)))
    .returning({ id: schema.orders.id });
  if (!claimed) return 0;
  const qty = await orderStock(db, orderId);
  for (const [variantId, n] of qty) await change(db, variantId, n);
  return qty.size;
}

/** A line of an order that took stock changed option: the old one goes back, the new one comes off. */
export async function moveLineStock(db: Db, order: { stockTakenAt: Date | null }, line: { preorder: boolean; quantity: number }, from: string | null, to: string) {
  if (!order.stockTakenAt || line.preorder) return;
  const own = await ownStockVariants(db, [from, to].filter((v): v is string => !!v));
  if (from && own.has(from)) await change(db, from, line.quantity);
  if (own.has(to)) await change(db, to, -line.quantity);
}
