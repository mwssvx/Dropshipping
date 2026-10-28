// Customers as a spreadsheet, for a mailing tool or the merchant's own records: one row per
// customer on the Customers page, with the same search and tag. Amounts spent are only for people
// who can see the store's money.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { listCustomers, type CustomerFilter } from "./buyers";
import { csvCell } from "./payouts";

const MAX_ROWS = 20_000;
const PAID = ["paid", "partially_refunded", "refunded"] as const;

export async function customersCsv(db: Db, shopId: string, opts: { query?: string; tag?: string; filter?: CustomerFilter; country?: string; discountId?: string; productId?: string; minSpentMinor?: number; money: boolean }) {
  const customers = await listCustomers(db, shopId, { query: opts.query, tag: opts.tag, filter: opts.filter, country: opts.country, discountId: opts.discountId, productId: opts.productId, minSpentMinor: opts.money ? opts.minSpentMinor : undefined, limit: MAX_ROWS });
  // Where each customer's orders went: the country and city of their latest paid order, and when they first ordered.
  const orders = customers.length
    ? await db
        .select({ email: schema.orders.email, paidAt: schema.orders.paidAt, address: schema.orders.shippingAddress })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.shopId, shopId),
            inArray(schema.orders.paymentStatus, [...PAID]),
            isNotNull(schema.orders.paidAt),
            inArray(schema.orders.email, customers.map((c) => c.email)),
          ),
        )
    : [];
  const byEmail = new Map<string, { first: Date; last: Date; city: string | null; country: string | null }>();
  for (const o of orders) {
    if (!o.email) continue;
    const seen = byEmail.get(o.email);
    if (!seen) byEmail.set(o.email, { first: o.paidAt!, last: o.paidAt!, city: o.address?.city ?? null, country: o.address?.country ?? null });
    else {
      if (o.paidAt! < seen.first) seen.first = o.paidAt!;
      if (o.paidAt! > seen.last) Object.assign(seen, { last: o.paidAt!, city: o.address?.city ?? null, country: o.address?.country ?? null });
    }
  }
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const header = ["Email", "Name", "City", "Country", "Orders", ...(opts.money ? ["Spent"] : []), "First order", "Last order", "Email marketing", "Account", "Tags", "Customer since"];
  const rows = customers.map((c) => {
    const o = byEmail.get(c.email);
    return [
      c.email,
      c.name,
      o?.city ?? null,
      o?.country ?? null,
      c.orders,
      ...(opts.money ? [(c.spentMinor / 100).toFixed(2)] : []),
      day(o?.first),
      day(o?.last),
      c.acceptsMarketing ? "subscribed" : "not subscribed",
      c.lastSignInAt ? "yes" : "no",
      c.tags.join(", ") || null,
      day(c.createdAt),
    ];
  });
  return [header, ...rows].map((r) => r.map((v) => csvCell(v ?? null)).join(",")).join("\n") + "\n";
}
