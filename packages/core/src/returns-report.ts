// Returned most: which products come back, out of how many sold, and why. A product that keeps
// coming back for not fitting needs a size chart; one that arrives damaged needs better packing or
// another supplier. Counts units from orders paid in the period, so the share is of what sold then.
import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { RETURN_REASONS, schema, type Db } from "@sf/db";

const DAY = 86_400_000;
type Reason = (typeof RETURN_REASONS)[number];

export const RETURNS_REPORT_DAYS = [30, 90, 365] as const;
/** Below this many sold, a share returned would be noise, so only the count shows. */
export const RETURNS_MIN_SOLD = 5;
/** Products with this share or more coming back are flagged. */
export const HIGH_RETURN_SHARE = 0.1;

/** What to do about the main reason a product comes back, when there's something to do. */
export const RETURN_REASON_FIX: Partial<Record<Reason, string>> = {
  too_small_or_big: "Add a size chart or the measurements to the product page.",
  not_as_described: "Check the photos and description match what arrives.",
  damaged: "Ask the supplier to pack it better, or try another supplier.",
  wrong_item: "Check the supplier sends the right size or colour.",
  never_arrived: "Check the supplier's shipping method and tracking.",
};

/** Products returned most among orders paid in the last `days`, with how many sold and the reasons. */
export async function returnsByProduct(db: Db, shopId: string, opts: { days?: number; now?: Date; limit?: number } = {}) {
  const days = opts.days ?? 90;
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - days * DAY);
  const o = schema.orders;
  const l = schema.orderLines;
  const paid = and(eq(o.shopId, shopId), inArray(o.paymentStatus, ["paid", "partially_refunded", "refunded"]), ne(o.source, "replacement"), gte(o.paidAt, from), lt(o.paidAt, now));

  const [sold, requests] = await Promise.all([
    db
      .select({ productId: schema.variants.productId, units: sql<number>`sum(${l.quantity})::int` })
      .from(l)
      .innerJoin(o, eq(o.id, l.orderId))
      .innerJoin(schema.variants, eq(schema.variants.id, l.variantId))
      .where(paid)
      .groupBy(schema.variants.productId),
    db
      .select({ reason: schema.returnRequests.reason, items: schema.returnRequests.items })
      .from(schema.returnRequests)
      .innerJoin(o, eq(o.id, schema.returnRequests.orderId))
      .where(and(eq(schema.returnRequests.shopId, shopId), ne(schema.returnRequests.status, "declined"), paid)),
  ]);

  const lineIds = [...new Set(requests.flatMap((r) => r.items.map((i) => i.lineId)))];
  const lines = lineIds.length
    ? await db
        .select({ id: l.id, productId: schema.variants.productId })
        .from(l)
        .innerJoin(schema.variants, eq(schema.variants.id, l.variantId))
        .where(inArray(l.id, lineIds))
    : [];
  const productOf = new Map(lines.map((x) => [x.id, x.productId]));

  const returned = new Map<string, { units: number; reasons: Map<Reason, number> }>();
  const allReasons = new Map<Reason, number>();
  for (const r of requests) {
    for (const item of r.items) {
      const productId = productOf.get(item.lineId);
      if (!productId) continue;
      const row = returned.get(productId) ?? { units: 0, reasons: new Map() };
      row.units += item.quantity;
      row.reasons.set(r.reason, (row.reasons.get(r.reason) ?? 0) + item.quantity);
      returned.set(productId, row);
      allReasons.set(r.reason, (allReasons.get(r.reason) ?? 0) + item.quantity);
    }
  }

  const ids = [...returned.keys()];
  const products = ids.length ? await db.query.products.findMany({ where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids)), columns: { id: true, title: true } }) : [];
  const soldOf = new Map(sold.map((s) => [s.productId, Number(s.units)]));
  const byCount = (m: Map<Reason, number>) => [...m].map(([reason, units]) => ({ reason, units })).sort((a, b) => b.units - a.units || RETURN_REASONS.indexOf(a.reason) - RETURN_REASONS.indexOf(b.reason));
  const rows = products
    .map((p) => {
      const r = returned.get(p.id)!;
      const units = soldOf.get(p.id) ?? 0;
      const reasons = byCount(r.reasons);
      const share = units >= RETURNS_MIN_SOLD ? Math.min(1, r.units / units) : null;
      return { productId: p.id, title: p.title, sold: units, returned: r.units, share, high: share !== null && share >= HIGH_RETURN_SHARE, reasons, fix: RETURN_REASON_FIX[reasons[0]!.reason] ?? null };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || b.returned - a.returned || a.title.localeCompare(b.title))
    .slice(0, opts.limit ?? 10);

  const soldTotal = sold.reduce((s, x) => s + Number(x.units), 0);
  const returnedTotal = [...returned.values()].reduce((s, x) => s + x.units, 0);
  return { days, sold: soldTotal, returned: returnedTotal, share: soldTotal ? Math.min(1, returnedTotal / soldTotal) : null, reasons: byCount(allReasons), products: rows };
}
