// Supplier scorecard: how each supplier has done with this store's orders lately. How many orders
// it couldn't take, how fast it ships, how long parcels take to arrive, and how many orders came
// back with a problem it caused (never arrived, damaged, wrong or not as described, or replaced).
// Each gets a plain grade, and a poor one points at backup suppliers.
import { and, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

const DAY = 86_400_000;
/** Below this many orders a grade would be noise. */
export const SCORE_MIN_ORDERS = 5;
/** Return reasons that are the supplier's doing, not the buyer's. */
const SUPPLIER_FAULTS = ["never_arrived", "damaged", "wrong_item", "not_as_described"] as const;

export type SupplierGrade = "good" | "watch" | "poor" | "too_few";

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);
const days = (ms: number) => Math.round((ms / DAY) * 10) / 10;

/** Thresholds for the grade; the worst measure decides it. */
export function gradeSupplier(s: { orders: number; failedRate: number; problemRate: number; shipDays: number | null }): SupplierGrade {
  if (s.orders < SCORE_MIN_ORDERS) return "too_few";
  const ship = s.shipDays ?? 0;
  if (s.failedRate > 10 || s.problemRate > 5 || ship > 7) return "poor";
  if (s.failedRate > 5 || s.problemRate > 2 || ship > 4) return "watch";
  return "good";
}

/** Each supplier's record over the last `days` days (90 by default), busiest first. */
export async function supplierScorecard(db: Db, shopId: string, opts: { days?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.days ?? 90) * DAY);
  const [suppliers, rows] = await Promise.all([
    db.query.suppliers.findMany({ where: eq(schema.suppliers.shopId, shopId) }),
    db
      .select({
        orderId: schema.fulfillments.orderId,
        supplierId: schema.fulfillments.supplierId,
        status: schema.fulfillments.status,
        placedAt: schema.fulfillments.placedAt,
        shippedAt: schema.fulfillments.shippedAt,
        deliveredAt: schema.fulfillments.deliveredAt,
      })
      .from(schema.fulfillments)
      .where(and(eq(schema.fulfillments.shopId, shopId), isNotNull(schema.fulfillments.supplierId), ne(schema.fulfillments.status, "cancelled"), gte(schema.fulfillments.createdAt, since)))
      .limit(50_000),
  ]);
  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  // Orders with a problem the supplier caused: a return for one of those reasons, or a free replacement.
  const problemOrders = new Set<string>();
  for (let i = 0; i < orderIds.length; i += 1000) {
    const chunk = orderIds.slice(i, i + 1000);
    const [returns, replaced] = await Promise.all([
      db
        .select({ orderId: schema.returnRequests.orderId })
        .from(schema.returnRequests)
        .where(and(inArray(schema.returnRequests.orderId, chunk), inArray(schema.returnRequests.reason, [...SUPPLIER_FAULTS]))),
      db.select({ orderId: schema.orders.replacesOrderId }).from(schema.orders).where(inArray(schema.orders.replacesOrderId, chunk)),
    ]);
    for (const r of [...returns, ...replaced]) if (r.orderId) problemOrders.add(r.orderId);
  }
  // Products with no backup, to suggest one when a supplier does poorly.
  const unbacked = await db
    .select({ supplierId: schema.products.supplierId })
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), isNull(schema.products.backup), eq(schema.products.status, "active")));

  return suppliers
    .map((s) => {
      const mine = rows.filter((r) => r.supplierId === s.id);
      const failed = mine.filter((r) => r.status === "failed").length;
      const shipped = mine.filter((r) => r.placedAt && r.shippedAt);
      const delivered = mine.filter((r) => r.placedAt && r.deliveredAt);
      // Placed over a week ago and still not shipped.
      const late = mine.filter((r) => r.status === "placed" && r.placedAt && now.getTime() - r.placedAt.getTime() > 7 * DAY).length;
      const problems = new Set(mine.filter((r) => problemOrders.has(r.orderId)).map((r) => r.orderId)).size;
      const shipMedian = median(shipped.map((r) => r.shippedAt!.getTime() - r.placedAt!.getTime()));
      const deliverMedian = median(delivered.map((r) => r.deliveredAt!.getTime() - r.placedAt!.getTime()));
      const stats = {
        orders: mine.length,
        failed,
        failedRate: pct(failed, mine.length),
        shipped: shipped.length,
        shipDays: shipMedian == null ? null : days(shipMedian),
        deliverDays: deliverMedian == null ? null : days(deliverMedian),
        late,
        problems,
        problemRate: pct(problems, shipped.length || mine.length - failed),
      };
      return {
        supplier: { id: s.id, provider: s.provider, name: s.name },
        ...stats,
        grade: gradeSupplier(stats),
        productsWithoutBackup: unbacked.filter((p) => p.supplierId === s.id).length,
      };
    })
    .filter((s) => s.orders > 0)
    .sort((a, b) => b.orders - a.orders);
}
