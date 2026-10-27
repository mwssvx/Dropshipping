import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { publishDueProducts } from "./publish-later";

/**
 * The numbers on the admin home page, counted in the database rather than by loading every order
 * and product, so a store with years of orders opens its home page as fast as a new one. Orders
 * count once they're paid; `today` is from `since` (the start of the merchant's day).
 */
export async function homeCounts(db: Db, shopId: string, since: Date) {
  // Scheduled drafts go on sale on time, as when the product list is opened.
  await publishDueProducts(db, shopId);
  const o = schema.orders;
  const from = sql`${since.toISOString()}::timestamptz`;
  const [[orders], [products]] = await Promise.all([
    db
      .select({
        paid: sql<number>`count(*)::int`,
        today: sql<number>`count(*) filter (where ${o.paidAt} >= ${from})::int`,
        todayMinor: sql<number>`coalesce(sum(${o.totalMinor}) filter (where ${o.paidAt} >= ${from}), 0)::bigint`,
        toSend: sql<number>`count(*) filter (where ${o.fulfillmentStatus} = 'unfulfilled' and ${o.heldAt} is null)::int`,
        held: sql<number>`count(*) filter (where ${o.fulfillmentStatus} = 'unfulfilled' and ${o.heldAt} is not null)::int`,
        problems: sql<number>`count(*) filter (where ${o.fulfillmentStatus} = 'problem')::int`,
      })
      .from(o)
      .where(and(eq(o.shopId, shopId), eq(o.paymentStatus, "paid"))),
    db
      .select({ all: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${schema.products.status} = 'active')::int` })
      .from(schema.products)
      .where(eq(schema.products.shopId, shopId)),
  ]);
  return { ...orders!, todayMinor: Number(orders!.todayMinor), products: products!.all, activeProducts: products!.active };
}
