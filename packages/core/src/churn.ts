// Regulars who may be slipping away: buyers who ordered at least twice and have now gone well past
// their own usual gap between orders. Each buyer is measured against their own rhythm, so someone
// who orders every two weeks shows up sooner than someone who orders twice a year.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

const PAID = ["paid", "partially_refunded", "refunded"] as const;
const DAY = 86_400_000;
/** The tag at-risk buyers get when the owner drafts a win-back email for them. */
export const AT_RISK_TAG = "at risk";
/** Past this, a buyer has left rather than slipped; the win-back emails cover them. */
export const AT_RISK_MAX_DAYS = 365;

export type AtRiskCustomer = {
  customerId: string;
  email: string;
  name: string | null;
  orders: number;
  spentMinor: number;
  usualGapDays: number;
  daysSince: number;
  /** Said yes to marketing emails and hasn't unsubscribed. */
  subscribed: boolean;
};

export async function atRiskCustomers(db: Db, shopId: string, now = new Date()): Promise<AtRiskCustomer[]> {
  const rows = await db
    .select({
      customerId: schema.customers.id,
      email: schema.customers.email,
      name: schema.customers.name,
      accepts: schema.customers.acceptsMarketing,
      unsubscribedAt: schema.customers.unsubscribedAt,
      orders: sql<number>`count(*)::int`,
      spent: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)::bigint`,
      first: sql<string>`min(${schema.orders.paidAt})`,
      last: sql<string>`max(${schema.orders.paidAt})`,
    })
    .from(schema.customers)
    .innerJoin(
      schema.orders,
      and(
        eq(schema.orders.shopId, schema.customers.shopId),
        sql`lower(${schema.orders.email}) = ${schema.customers.email}`,
        inArray(schema.orders.paymentStatus, [...PAID]),
        isNotNull(schema.orders.paidAt),
        sql`${schema.orders.source} <> 'replacement'`,
      ),
    )
    .where(eq(schema.customers.shopId, shopId))
    .groupBy(schema.customers.id)
    .having(sql`count(*) >= 2`);
  return rows
    .flatMap((r) => {
      const first = new Date(r.first).getTime();
      const last = new Date(r.last).getTime();
      const usualGapDays = Math.max(1, Math.round((last - first) / DAY / (r.orders - 1)));
      const daysSince = Math.floor((now.getTime() - last) / DAY);
      const late = daysSince > Math.max(usualGapDays * 1.5, usualGapDays + 14);
      if (!late || daysSince > AT_RISK_MAX_DAYS) return [];
      return [{ customerId: r.customerId, email: r.email, name: r.name, orders: r.orders, spentMinor: Number(r.spent), usualGapDays, daysSince, subscribed: r.accepts && !r.unsubscribedAt }];
    })
    .sort((a, b) => b.spentMinor - a.spentMinor);
}

/** Adds the at-risk tag to these customers, leaving their other tags as they are. */
export async function tagAtRisk(db: Db, shopId: string, customerIds: string[]) {
  if (!customerIds.length) return 0;
  const rows = await db.query.customers.findMany({ where: and(eq(schema.customers.shopId, shopId), inArray(schema.customers.id, customerIds)), columns: { id: true, tags: true } });
  let tagged = 0;
  for (const c of rows) {
    if (c.tags.includes(AT_RISK_TAG)) continue;
    await db.update(schema.customers).set({ tags: [...c.tags, AT_RISK_TAG] }).where(eq(schema.customers.id, c.id));
    tagged++;
  }
  return tagged;
}
