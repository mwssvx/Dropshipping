// Supplier money: a dropshipper pays the supplier when each order is sent to it (CJ's wallet,
// AliExpress's saved card), days before the buyer's money reaches their bank. Run dry and orders
// stop at the supplier with "insufficient balance". This says how much to keep there, from what
// recent orders cost, next to what's waiting and what's on its way from sales.
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

const DAY = 86_400_000;
export const SUPPLIER_MONEY_DAYS = 14;

/**
 * What supplier orders cost a day over the last 14 days (goods at supplier cost plus the shipping
 * charged, which pays the supplier's shipping), a week's worth to keep in the supplier balance, and
 * orders stuck because the balance ran out with what their goods cost.
 */
export async function supplierMoney(db: Db, shopId: string, now = new Date()) {
  const o = schema.orders;
  const l = schema.orderLines;
  const since = new Date(now.getTime() - SUPPLIER_MONEY_DAYS * DAY);
  // Only lines a supplier sends: products with a supplier link, not the store's own stock.
  const [spent] = await db
    .select({
      goods: sql<number>`coalesce(sum(${l.unitCostMinor} * ${l.quantity}), 0)::bigint`,
      orders: sql<number>`count(distinct ${o.id})::int`,
    })
    .from(l)
    .innerJoin(o, eq(o.id, l.orderId))
    .innerJoin(schema.variants, eq(schema.variants.id, l.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(o.shopId, shopId), inArray(o.paymentStatus, ["paid", "partially_refunded"]), gte(o.paidAt, since), isNotNull(schema.products.supplierId), isNotNull(schema.products.sourceUrl)));
  const [shipping] = await db
    .select({ sum: sql<number>`coalesce(sum(${o.shippingMinor}), 0)::bigint` })
    .from(o)
    .where(
      and(
        eq(o.shopId, shopId),
        inArray(o.paymentStatus, ["paid", "partially_refunded"]),
        gte(o.paidAt, since),
        sql`exists (select 1 from ${schema.fulfillments} f where f.order_id = ${o.id} and f.supplier_id is not null)`,
      ),
    );
  const stuck = await db
    .select({ orderId: schema.fulfillments.orderId })
    .from(schema.fulfillments)
    .where(and(eq(schema.fulfillments.shopId, shopId), eq(schema.fulfillments.status, "failed"), eq(schema.fulfillments.problemCode, "insufficient_balance")));
  const stuckIds = [...new Set(stuck.map((s) => s.orderId))];
  const [stuckCost] = stuckIds.length
    ? await db
        .select({ sum: sql<number>`coalesce(sum(${l.unitCostMinor} * ${l.quantity}), 0)::bigint` })
        .from(l)
        .where(inArray(l.orderId, stuckIds))
    : [{ sum: 0 }];

  const total = Number(spent?.goods ?? 0) + Number(shipping?.sum ?? 0);
  const dailyMinor = Math.round(total / SUPPLIER_MONEY_DAYS);
  return {
    orders: Number(spent?.orders ?? 0),
    dailyMinor,
    /** A week of supplier orders at the recent rate, plus what the stuck orders need. */
    keepMinor: dailyMinor * 7 + Number(stuckCost?.sum ?? 0),
    waiting: { orders: stuckIds.length, costMinor: Number(stuckCost?.sum ?? 0) },
  };
}
