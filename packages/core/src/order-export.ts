// Orders as a spreadsheet: one row per item, with the order's details on every row so the file
// can be sorted and filtered without losing which order a line belongs to.
import { inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { listOrders } from "./orders";
import { csvCell } from "./payouts";

type Filter = Parameters<typeof listOrders>[2];

/** The orders matching the order list's filters (and an optional date range), oldest first. */
export async function ordersCsv(db: Db, shopId: string, filter: Filter = {}) {
  const orders = (await listOrders(db, shopId, filter)).reverse();
  const ids = orders.map((o) => o.id);
  const [lines, parcels] = ids.length
    ? await Promise.all([
        db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, ids) }),
        db.query.fulfillments.findMany({ where: inArray(schema.fulfillments.orderId, ids) }),
      ])
    : [[], []];
  const major = (m: number) => (m / 100).toFixed(2);
  const header = [
    "Order", "Placed", "Paid", "Email", "Name", "Address", "Address 2", "City", "Region", "Postal code", "Country",
    "Payment", "Fulfilment", "Currency", "Subtotal", "Discount", "Discount code", "Shipping", "Delivery protection", "Tax", "Total", "Refunded",
    "Item", "Quantity", "Unit price", "Pre-order", "Personalisation", "Tracking", "Tags", "Buyer note", "Your note",
  ];
  const rows = orders.flatMap((o) => {
    const a = o.shippingAddress;
    const tracking = parcels.filter((f) => f.orderId === o.id && f.trackingNumber).map((f) => (f.carrier ? `${f.carrier} ${f.trackingNumber}` : f.trackingNumber)).join("; ");
    const order = [
      o.number, o.createdAt.toISOString(), o.paidAt?.toISOString() ?? null, o.email, a.name, a.line1, a.line2 ?? null, a.city, a.region ?? null, a.postalCode, a.country,
      o.paymentStatus, o.fulfillmentStatus, o.currency, major(o.subtotalMinor), major(o.discountMinor), o.discountCode, major(o.shippingMinor), major(o.protectionMinor), major(o.taxMinor), major(o.totalMinor), major(o.refundedMinor),
    ];
    const extra = [tracking || null, o.tags.join(", ") || null, o.buyerNote, o.staffNote];
    const mine = lines.filter((l) => l.orderId === o.id);
    if (!mine.length) return [[...order, null, null, null, null, null, ...extra]];
    return mine.map((l) => [
      ...order,
      l.title, l.quantity, major(l.unitPriceMinor), l.preorder ? "yes" : null,
      l.personalization?.map((p) => `${p.label}: ${p.value}`).join("; ") || null,
      ...extra,
    ]);
  });
  return [header, ...rows].map((r) => r.map((c) => csvCell(c ?? null)).join(",")).join("\n") + "\n";
}
