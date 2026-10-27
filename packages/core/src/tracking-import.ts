// Tracking from a spreadsheet. A merchant who packs orders themselves, or whose supplier sends a
// list of tracking numbers instead of using the supplier page, uploads one file and every order in
// it is marked shipped, and the buyer gets the shipping email. The file needs an Order column, a
// Carrier column and a Tracking number column, and can have a Tracking link. Uploading the same
// file again changes nothing: orders that already have that tracking number are left alone.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";
import { refreshOrderFulfillment, sendOrderEmail, trackingInput, type FulfillmentContext } from "./fulfillment";
import { csvCell } from "./payouts";
import { parseCsv } from "./shopify-import";

export const MAX_TRACKING_ROWS = 2000;

export type TrackingImportResult = {
  /** Order numbers marked shipped by this file. */
  shipped: number[];
  /** Order numbers that already had the file's tracking number. */
  alreadyHere: number[];
  /** Rows that weren't used, with the line they're on and why. */
  skipped: { line: number; order: string; reason: string }[];
};

type Row = { line: number; order: string; number: number | null; carrier: string; trackingNumber: string; url: string };

/** Reads the file's columns. Accepts our own names and the usual ones from other tools. */
export function readTrackingCsv(text: string): Row[] {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const at = (...names: string[]) => names.map((n) => cols.indexOf(n)).find((i) => i >= 0);
  const i = {
    order: at("order", "order number", "order #", "order no", "order id"),
    carrier: at("carrier", "shipping carrier", "tracking company", "courier"),
    tracking: at("tracking number", "tracking", "tracking no", "tracking #"),
    url: at("tracking link", "tracking url"),
  };
  if (i.order === undefined || i.carrier === undefined || i.tracking === undefined) {
    throw new UserError("The file needs Order, Carrier and Tracking number columns. Download the list of orders waiting for tracking to start from.");
  }
  const cell = (row: string[], n: number | undefined) => (n === undefined ? "" : (row[n] ?? "").trim());
  const out: Row[] = [];
  rows.forEach((row, n) => {
    if (!row.some((c) => c.trim())) return;
    const order = cell(row, i.order);
    const digits = order.replace(/^#/, "").trim();
    out.push({
      line: n + 2,
      order,
      number: /^\d{1,9}$/.test(digits) ? Number(digits) : null,
      carrier: cell(row, i.carrier),
      trackingNumber: cell(row, i.tracking),
      url: cell(row, i.url),
    });
  });
  if (out.length > MAX_TRACKING_ROWS) throw new UserError(`That file has more than ${MAX_TRACKING_ROWS.toLocaleString("en-US")} rows. Split it into smaller files.`);
  return out;
}

/** Marks the orders in a tracking file shipped. Rows that can't be used are reported, not thrown. */
export async function importTracking(ctx: FulfillmentContext, shopId: string, text: string): Promise<TrackingImportResult> {
  const { db } = ctx;
  const rows = readTrackingCsv(text);
  if (!rows.length) throw new UserError("That file has no orders in it.");
  const numbers = [...new Set(rows.map((r) => r.number).filter((n): n is number => n !== null))];
  const orders = numbers.length
    ? await db.query.orders.findMany({ where: and(eq(schema.orders.shopId, shopId), inArray(schema.orders.number, numbers)) })
    : [];
  const byNumber = new Map(orders.map((o) => [o.number, o]));
  const result: TrackingImportResult = { shipped: [], alreadyHere: [], skipped: [] };
  const skip = (r: Row, reason: string) => result.skipped.push({ line: r.line, order: r.order, reason });
  // Our own order download has a row per item, so one order can come up several times.
  const seen = new Set<string>();
  const shippedIds = new Set<string>();

  for (const r of rows) {
    if (r.number === null) {
      skip(r, r.order ? "That isn't an order number." : "The order number is missing.");
      continue;
    }
    const parsed = trackingInput.safeParse({ carrier: r.carrier, trackingNumber: r.trackingNumber, url: r.url });
    if (!parsed.success) {
      skip(r, parsed.error.issues[0]!.message);
      continue;
    }
    const { carrier, trackingNumber, url } = parsed.data;
    const key = `${r.number}\n${trackingNumber.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const order = byNumber.get(r.number);
    if (!order) {
      skip(r, "There's no order with this number.");
      continue;
    }
    if (order.paymentStatus === "refunded") {
      skip(r, "This order was refunded.");
      continue;
    }
    if (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded") {
      skip(r, "This order isn't paid yet.");
      continue;
    }
    if (order.heldAt) {
      skip(r, "This order is on hold for the risk check. Send or refund it from its page first.");
      continue;
    }
    if (order.pickup) {
      skip(r, "The buyer is picking this order up, so it doesn't need tracking.");
      continue;
    }
    if (order.localDelivery) {
      skip(r, "You're delivering this order yourself. Mark it delivered from its page.");
      continue;
    }
    const parcels = (await db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id) })).filter((f) => f.status !== "cancelled");
    if (parcels.some((f) => f.trackingNumber?.toLowerCase() === trackingNumber.toLowerCase())) {
      if (!shippedIds.has(order.id) && !result.alreadyHere.includes(order.number)) result.alreadyHere.push(order.number);
      continue;
    }
    if (parcels.some((f) => f.status === "pending" || f.status === "placing")) {
      skip(r, "This order is still being sent to the supplier. Try again in a minute.");
      continue;
    }
    // A parcel the supplier hasn't shipped yet gets the tracking; a failed one becomes the
    // merchant's own and stops being synced; an order nobody sent gets a new parcel.
    const open = parcels.find((f) => f.status === "placed") ?? parcels.find((f) => f.status === "failed");
    if (!open && parcels.length) {
      skip(r, "This order has already shipped with other tracking.");
      continue;
    }
    const t = ctx.now?.() ?? new Date();
    const values = {
      status: "shipped" as const,
      carrier,
      trackingNumber,
      trackingUrl: url || null,
      shippedAt: t,
      problemCode: null,
      problemMessage: null,
      updatedAt: t,
    };
    if (open) {
      await db
        .update(schema.fulfillments)
        .set(open.status === "failed" ? { ...values, supplierOrderRef: null } : values)
        .where(eq(schema.fulfillments.id, open.id));
    } else {
      await db.insert(schema.fulfillments).values({ ...values, shopId, orderId: order.id, supplierId: null });
    }
    await refreshOrderFulfillment(db, order.id, t);
    await sendOrderEmail(ctx, order.id, "shipping_update");
    if (!shippedIds.has(order.id)) result.shipped.push(order.number);
    shippedIds.add(order.id);
  }
  return result;
}

/** Paid orders that haven't shipped yet and aren't on hold, oldest first. Orders picked up in person never get tracking. */
export async function ordersWaitingForTracking(db: Db, shopId: string) {
  const orders = (
    await db.query.orders.findMany({
      where: and(
        eq(schema.orders.shopId, shopId),
        inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]),
        inArray(schema.orders.fulfillmentStatus, ["unfulfilled", "sent_to_supplier", "partially_shipped", "problem"]),
      ),
      orderBy: (o, { asc }) => [asc(o.number)],
    })
  ).filter((o) => !o.heldAt && !o.pickup && !o.localDelivery);
  const ids = orders.map((o) => o.id);
  const tracked = ids.length
    ? await db.query.fulfillments.findMany({ where: and(inArray(schema.fulfillments.orderId, ids), isNotNull(schema.fulfillments.trackingNumber)) })
    : [];
  // A partly shipped order still has parcels to go, so it stays in the list.
  return orders.filter((o) => o.fulfillmentStatus === "partially_shipped" || !tracked.some((f) => f.orderId === o.id));
}

/**
 * The orders waiting for tracking as a file to fill in: the order, who it's for and what's in it,
 * then empty Carrier, Tracking number and Tracking link columns.
 */
export async function trackingTemplateCsv(db: Db, shopId: string) {
  const waiting = await ordersWaitingForTracking(db, shopId);
  const ids = waiting.map((o) => o.id);
  const lines = ids.length ? await db.query.orderLines.findMany({ where: inArray(schema.orderLines.orderId, ids) }) : [];
  const header = ["Order", "Name", "Country", "Items", "Carrier", "Tracking number", "Tracking link"];
  const rows = waiting.map((o) => [
    o.number,
    o.shippingAddress.name,
    o.shippingAddress.country,
    lines.filter((l) => l.orderId === o.id).map((l) => `${l.quantity} × ${l.title}`).join("; "),
    null,
    null,
    null,
  ]);
  return [header, ...rows].map((r) => r.map((c) => csvCell(c ?? null)).join(",")).join("\n") + "\n";
}
