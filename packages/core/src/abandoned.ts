import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

/** A checkout counts as abandoned once it's been left unpaid this long, as for the reminder email. */
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;
/** How far back the abandoned checkouts page looks. */
export const ABANDONED_DAYS = 30;
export const ABANDONED_PAGE_SIZE = 50;

/**
 * Checkouts buyers started but didn't pay for, newest first, from the last 30 days: who, what it
 * came to, whether the reminder (and the reminder with a code) went out, and whether the buyer
 * came back and paid since, on this checkout or a new one. Checkouts paid after a reminder stay
 * listed, as recovered. Payment links the merchant sent aren't
 * included; those show on the order list as waiting to be paid.
 */
export async function abandonedCheckouts(db: Db, shopId: string, opts: { before?: number; size?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const size = opts.size ?? ABANDONED_PAGE_SIZE;
  const o = schema.orders;
  const reminder = sql`exists (select 1 from emails e where e.order_id = ${o.id} and e.kind = 'abandoned_cart')`;
  const where = and(
    eq(o.shopId, shopId),
    // Still unpaid, or paid after the reminder brought the buyer back.
    or(inArray(o.paymentStatus, ["pending", "failed"]), reminder),
    eq(o.source, "checkout"),
    // Choosing to pay by bank transfer isn't leaving.
    isNull(o.manualPayment),
    // Left an hour ago, or already reminded (the merchant can send reminders sooner by hand).
    or(lte(o.createdAt, new Date(now.getTime() - ABANDONED_AFTER_MS)), reminder),
    gte(o.createdAt, new Date(now.getTime() - ABANDONED_DAYS * 86_400_000)),
  );
  // Written out with table names: inside a select list Drizzle leaves column names bare, which
  // would be ambiguous in these subqueries.
  const sent = (kind: string) => sql<boolean>`exists (select 1 from emails e where e.order_id = "orders"."id" and e.kind = ${kind})`;
  const recovered = sql<number | null>`(select min(later.number) from orders later where later.shop_id = "orders"."shop_id" and lower(later.email) = lower("orders"."email") and later.payment_status in ('paid', 'partially_refunded', 'refunded') and later.created_at >= "orders"."created_at")`;
  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: o.id,
        number: o.number,
        createdAt: o.createdAt,
        email: o.email,
        name: sql<string>`"orders"."shipping_address"->>'name'`,
        totalMinor: o.totalMinor,
        currency: o.currency,
        items: sql<number>`(select coalesce(sum(l.quantity), 0)::int from order_lines l where l.order_id = "orders"."id")`,
        reminded: sent("abandoned_cart"),
        offered: sent("abandoned_cart_offer"),
        recoveredBy: recovered,
      })
      .from(o)
      .where(and(where, opts.before ? lt(o.number, opts.before) : undefined))
      .orderBy(desc(o.number))
      .limit(size + 1),
    db
      .select({
        count: sql<number>`count(*)::int`,
        valueMinor: sql<number>`coalesce(sum(${o.totalMinor}), 0)::bigint`,
        recovered: sql<number>`count(*) filter (where ${recovered} is not null)::int`,
      })
      .from(o)
      .where(where),
  ]);
  const page = rows.slice(0, size).map((r) => ({ ...r, recoveredBy: r.recoveredBy === null ? null : Number(r.recoveredBy) }));
  return {
    checkouts: page,
    older: rows.length > size ? page.at(-1)!.number : null,
    totals: { count: totals!.count, valueMinor: Number(totals!.valueMinor), recovered: totals!.recovered },
  };
}
