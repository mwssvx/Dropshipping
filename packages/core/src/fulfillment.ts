import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type Db, type PersonalizationValue } from "@sf/db";
import { createHash } from "node:crypto";
import { z } from "zod";
import { cartDelivery, formatDeliveryWindow, orderDelivery } from "./delivery";
import { NotFoundError, UserError } from "./errors";
import type { Mailer } from "./email";
import { formatMoney } from "./money";
import { buyerAmounts } from "./currency";
import { SupplierError, type ProblemCode, type Suppliers } from "./suppliers";
import { sendPurchaseOrder, supplierLabel } from "./own-suppliers";
import { issueGiftCardsForOrder } from "./gift-cards";
import { giftReturnCode } from "./gift-returns";
import { DOWNLOADS_PER_ITEM, nothingToShip, orderDownloads } from "./digital";
import { earnPoints } from "./rewards";
import { applyTagRulesForOrder } from "./tag-rules";
import { issueInvoice } from "./invoices";
import { checkOrderRisk } from "./risk";
import { takeOrderStock } from "./own-stock";
import { describePersonalization } from "./personalization";
import { formatShipsBy, preorderWaitingOn } from "./preorders";
import { MAX_BULK_ORDERS } from "./orders";

/** A personalised item's text, under it in emails. */
/**
 * "Order by Dec 15 to get it in time for Christmas." for a cart reminder, while the store has a
 * holiday order-by date and there's still time. Nothing once it's too late: a reminder shouldn't
 * promise what the store can't keep.
 */
async function holidayReminder(db: Db, shop: Shop, order: Order, lines: { variantId: string | null }[]) {
  if (!shop.holidayDeadline) return [];
  const ids = lines.map((l) => l.variantId).filter((v): v is string => !!v);
  if (!ids.length) return [];
  const rows = await db
    .select({ variantId: schema.variants.id, giftCard: schema.products.giftCard, digital: schema.products.digital })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(inArray(schema.variants.id, ids));
  const holiday = (await cartDelivery(db, shop, rows, { country: order.shippingAddress.country }))?.holiday;
  if (!holiday?.orderBy) return [];
  const day = holiday.today ? "today" : `by ${holiday.orderBy.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
  return [``, `Order ${day} to get it in time for ${holiday.name}.`];
}

const personalised = (l: { personalization: PersonalizationValue[] | null }) => (l.personalization ? [`    ${describePersonalization(l.personalization)}`] : []);

type Order = typeof schema.orders.$inferSelect;
type Fulfillment = typeof schema.fulfillments.$inferSelect;
type Shop = typeof schema.shops.$inferSelect;

/** Everything the fulfilment flow talks to. Built once per server from the environment. */
export type FulfillmentContext = {
  db: Db;
  suppliers: Suppliers;
  mailer: Mailer;
  /** Public link to the buyer's order status page. */
  orderStatusUrl: (shop: Shop, order: Order) => string | Promise<string>;
  /** Link back to an unpaid order's payment page, for checkout reminders. Defaults to the status page. */
  payUrl?: (shop: Shop, order: Order) => string | Promise<string>;
  /** The private page where one of the merchant's own suppliers adds tracking. */
  supplierPortalUrl?: (token: string) => string;
  /** The store's public address, for gift card emails. Defaults to the order status link's origin. */
  storeAddress?: (shop: Shop) => string | Promise<string>;
  now?: () => Date;
};

/** A placed order with no tracking after this long is flagged for the merchant. */
export const LATE_AFTER_DAYS = 7;
/** A fulfilment stuck in "placing" this long (crash mid-call) can be claimed again. */
const PLACING_TIMEOUT_MS = 10 * 60_000;

/** What the merchant should do about each kind of problem. */
export const PROBLEM_FIXES: Record<ProblemCode, string> = {
  out_of_stock: "Pick another supplier for this item and add tracking yourself, or refund the customer.",
  address_unsupported: "Check the address with the customer, or send it yourself and add tracking.",
  insufficient_balance: "Top up your supplier wallet, then try again.",
  product_unavailable: "The supplier stopped selling this item. Source it elsewhere and add tracking, or refund the customer.",
  supplier_unreachable: "The supplier didn't answer. Try again in a few minutes.",
  not_connected: "Reconnect the supplier in Suppliers, then try again.",
  late_shipment: "Ask the supplier for an update. If it doesn't ship soon, refund the customer.",
  unknown: "Try again. If it keeps failing, send it yourself and add tracking.",
};

const now = (ctx: FulfillmentContext) => ctx.now?.() ?? new Date();

/**
 * Send a paid order's items to their suppliers. Safe to call more than once: each supplier gets
 * one fulfilment row per order, and a row is only placed by whoever claims it.
 */
export async function routeOrder(ctx: FulfillmentContext, orderId: string) {
  const { db } = ctx;
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order");
  if (order.paymentStatus !== "paid") return { placed: 0, failed: 0, skipped: "not_paid" as const };
  if (order.heldAt) return { placed: 0, failed: 0, skipped: "held" as const };
  // A pre-order waits until what was pre-ordered is back in stock; the daily job tries again.
  if (order.preorderShipsBy && (await preorderWaitingOn(db, order.id)).length) return { placed: 0, failed: 0, skipped: "preorder" as const };

  const lines = await db
    .select({ line: schema.orderLines, variant: schema.variants, product: schema.products })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, order.id));
  const links = await db.query.suppliers.findMany({ where: eq(schema.suppliers.shopId, order.shopId) });
  const own = new Set(links.filter((l) => l.provider === "email").map((l) => l.id));
  const bySupplier = new Map<string, RouteLine[]>();
  for (const { line, variant, product } of lines) {
    // Own suppliers are sent item names, so every variant goes to them; API suppliers need their own ids.
    const ref = product.supplierId && own.has(product.supplierId) ? variant.id : variant.supplierVariantRef;
    if (!product.supplierId || !ref) continue; // merchant ships these themselves
    const list = bySupplier.get(product.supplierId) ?? [];
    list.push({ variantRef: ref, quantity: line.quantity, lineId: line.id, note: describePersonalization(line.personalization) ?? undefined, backup: product.backup?.gone ? undefined : product.backup?.variants[variant.id] && { supplierId: product.backup.supplierId, ...product.backup.variants[variant.id]! } });
    bySupplier.set(product.supplierId, list);
  }

  // Items a backup supplier took instead. One that went out stays there; one that never went out
  // (cancelled to change the order, say) is tried at the main supplier again first.
  const backups = await db.query.fulfillments.findMany({ where: and(eq(schema.fulfillments.orderId, order.id), isNotNull(schema.fulfillments.backupForSupplierId)) });
  const covered = new Set<string>();
  for (const f of backups) {
    if (["pending", "failed", "cancelled"].includes(f.status)) await db.delete(schema.fulfillments).where(eq(schema.fulfillments.id, f.id));
    else covered.add(f.backupForSupplierId!);
  }

  let placed = 0;
  let failed = 0;
  for (const [supplierId, supplierLines] of bySupplier) {
    if (covered.has(supplierId)) continue;
    await db
      .insert(schema.fulfillments)
      .values({ shopId: order.shopId, orderId: order.id, supplierId })
      .onConflictDoNothing();
    const t = now(ctx);
    const [claimed] = await db
      .update(schema.fulfillments)
      .set({ status: "placing", attempts: sql`${schema.fulfillments.attempts} + 1`, updatedAt: t })
      .where(
        and(
          eq(schema.fulfillments.orderId, order.id),
          eq(schema.fulfillments.supplierId, supplierId),
          or(
            inArray(schema.fulfillments.status, ["pending", "failed"]),
            and(eq(schema.fulfillments.status, "placing"), lt(schema.fulfillments.updatedAt, new Date(t.getTime() - PLACING_TIMEOUT_MS))),
          ),
        ),
      )
      .returning();
    if (!claimed) continue;

    const link = links.find((l) => l.id === supplierId);
    try {
      if (!link || link.status === "disconnected") throw new SupplierError("not_connected", "This supplier is disconnected.");
      const { supplierOrderRef } =
        link.provider === "email"
          ? await sendPurchaseOrder(ctx, link, order)
          : await ctx.suppliers.get(link.provider).placeOrder({
              reference: claimed.id,
              email: order.email,
              address: order.shippingAddress,
              lines: supplierLines.map((l) => ({ variantRef: l.variantRef, quantity: l.quantity, ...(l.note ? { note: l.note } : {}) })),
            });
      await db
        .update(schema.fulfillments)
        .set({ status: "placed", supplierOrderRef, placedAt: now(ctx), problemCode: null, problemMessage: null, backupNote: null, updatedAt: now(ctx) })
        .where(eq(schema.fulfillments.id, claimed.id));
      placed++;
    } catch (e) {
      const err = e instanceof SupplierError ? e : new SupplierError("unknown", e instanceof Error ? e.message : String(e), true);
      if (link && BACKUP_FOR.has(err.code) && (await placeWithBackup(ctx, order, claimed, link, links, supplierLines, err))) {
        placed++;
        continue;
      }
      await db
        .update(schema.fulfillments)
        .set({ status: "failed", problemCode: err.code, problemMessage: err.message, updatedAt: now(ctx) })
        .where(eq(schema.fulfillments.id, claimed.id));
      failed++;
    }
  }
  await refreshOrderFulfillment(db, order.id, now(ctx));
  return { placed, failed, skipped: null };
}

type RouteLine = {
  variantRef: string;
  quantity: number;
  lineId: string;
  /** The buyer's personalisation, for the supplier. */
  note?: string;
  /** The same option at the product's backup supplier. */
  backup?: { supplierId: string; ref: string; costMinor: number };
};
type SupplierLink = typeof schema.suppliers.$inferSelect;

/** Problems a backup supplier can get round. */
const BACKUP_FOR = new Set<ProblemCode>(["out_of_stock", "product_unavailable"]);

/**
 * The main supplier couldn't take these items, so send the ones with a backup there instead. Only
 * when everything in the supplier order can go to one place; otherwise it stays a problem for the
 * merchant. Returns whether the backup took the order.
 */
async function placeWithBackup(ctx: FulfillmentContext, order: Order, claimed: Fulfillment, main: SupplierLink, links: SupplierLink[], lines: RouteLine[], err: SupplierError) {
  const { db } = ctx;
  if (!lines.some((l) => l.backup)) return false;
  const targets = new Set(lines.map((l) => l.backup?.supplierId ?? main.id));
  const target = targets.size === 1 ? links.find((l) => l.id === [...targets][0]) : undefined;
  if (!target || target.provider === "email" || target.status === "disconnected") return false;
  if (target.id !== main.id) {
    // One supplier order per supplier: one already placed with the backup can't take more.
    const other = await db.query.fulfillments.findFirst({ where: and(eq(schema.fulfillments.orderId, order.id), eq(schema.fulfillments.supplierId, target.id)) });
    if (other && !["pending", "failed", "cancelled"].includes(other.status)) return false;
    if (other) await db.delete(schema.fulfillments).where(eq(schema.fulfillments.id, other.id));
  }
  let supplierOrderRef: string;
  try {
    ({ supplierOrderRef } = await ctx.suppliers.get(target.provider).placeOrder({
      reference: claimed.id,
      email: order.email,
      address: order.shippingAddress,
      lines: lines.map((l) => ({ variantRef: l.backup?.ref ?? l.variantRef, quantity: l.quantity, ...(l.note ? { note: l.note } : {}) })),
    }));
  } catch (e) {
    if (e instanceof SupplierError) return false;
    throw e;
  }
  const why = err.code === "out_of_stock" ? "was out of stock" : "no longer lists it";
  await db
    .update(schema.fulfillments)
    .set({
      supplierId: target.id,
      status: "placed",
      supplierOrderRef,
      placedAt: now(ctx),
      problemCode: null,
      problemMessage: null,
      backupNote: `The main supplier ${why}, so it went to the backup supplier (${supplierLabel(ctx.suppliers, target)}).`,
      backupForSupplierId: target.id === main.id ? null : main.id,
      updatedAt: now(ctx),
    })
    .where(eq(schema.fulfillments.id, claimed.id));
  // Profit follows what the backup charges.
  for (const l of lines) {
    if (l.backup) await db.update(schema.orderLines).set({ unitCostMinor: l.backup.costMinor }).where(eq(schema.orderLines.id, l.lineId));
  }
  return true;
}

/** The order's delivery status follows its fulfilments. */
export async function refreshOrderFulfillment(db: Db, orderId: string, at = new Date()) {
  const rows = (await db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, orderId) })).filter(
    (f) => f.status !== "cancelled",
  );
  const all = (s: Fulfillment["status"][]) => rows.every((f) => s.includes(f.status));
  let status: Order["fulfillmentStatus"];
  if (!rows.length) status = "unfulfilled";
  else if (rows.some((f) => f.status === "failed" || f.problemCode)) status = "problem";
  else if (all(["delivered"])) status = "delivered";
  else if (all(["shipped", "delivered"])) status = "shipped";
  else if (rows.some((f) => f.status === "shipped" || f.status === "delivered")) status = "partially_shipped";
  else status = "sent_to_supplier";
  await db.update(schema.orders).set({ fulfillmentStatus: status, updatedAt: at }).where(eq(schema.orders.id, orderId));
  return status;
}

/** Called once when a payment webhook first marks an order paid. */
export async function onOrderPaid(ctx: FulfillmentContext, orderId: string) {
  await issueInvoice(ctx.db, orderId);
  await takeOrderStock(ctx.db, orderId, now(ctx));
  await sendOrderEmail(ctx, orderId, "order_confirmation");
  await earnPoints(ctx.db, orderId);
  await applyTagRulesForOrder(ctx.db, orderId);
  if (await checkOrderRisk(ctx.db, orderId, now(ctx))) return { placed: 0, failed: 0, skipped: "held" as const };
  return routeAndIssue(ctx, orderId);
}

/** The merchant looked at a held order and wants it sent. */
export async function releaseHeldOrder(ctx: FulfillmentContext, shopId: string, orderId: string) {
  const order = await ctx.db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  if (order.paymentStatus === "refunded") throw new UserError("This order was refunded, so there's nothing to send.");
  if (!order.heldAt) throw new UserError("This order isn't on hold.");
  const [released] = await ctx.db
    .update(schema.orders)
    .set({ heldAt: null, riskReviewedAt: now(ctx), updatedAt: now(ctx) })
    .where(and(eq(schema.orders.id, order.id), isNotNull(schema.orders.heldAt)))
    .returning();
  if (!released) throw new UserError("This order isn't on hold.");
  return routeAndIssue(ctx, order.id);
}

/** Sends goods to suppliers and gift cards bought on the order to the buyer. Safe to repeat. */
export async function routeAndIssue(ctx: FulfillmentContext, orderId: string) {
  const storeAddress = ctx.storeAddress ?? (async (shop: Shop) => {
    const order = await ctx.db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
    return new URL(await ctx.orderStatusUrl(shop, order!)).origin;
  });
  const gifts = await issueGiftCardsForOrder({ db: ctx.db, mailer: ctx.mailer, storeAddress }, orderId);
  const routed = await routeOrder(ctx, orderId);
  // An order of only gift cards and downloads is done once the codes and links are out (the
  // links go in the order confirmation).
  if (gifts.onlyGiftCards || (await nothingToShip(ctx.db, orderId))) {
    await ctx.db.update(schema.orders).set({ fulfillmentStatus: "delivered", updatedAt: now(ctx) }).where(eq(schema.orders.id, orderId));
  }
  return routed;
}

/** Merchant pressed "Try again" on a problem order. */
export async function retryOrder(ctx: FulfillmentContext, shopId: string, orderId: string) {
  const order = await ctx.db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  const result = await routeOrder(ctx, order.id);
  if (result.failed) {
    const f = await ctx.db.query.fulfillments.findFirst({
      where: and(eq(schema.fulfillments.orderId, order.id), eq(schema.fulfillments.status, "failed")),
    });
    throw new UserError(`Still failing: ${f?.problemMessage ?? "the supplier refused the order."}`, f?.problemCode ?? "unknown");
  }
  return result;
}

export const trackingInput = z.object({
  carrier: z.string().trim().min(1, "Enter the carrier, for example USPS or Royal Mail."),
  trackingNumber: z.string().trim().min(4, "Enter the tracking number."),
  url: z
    .string()
    .trim()
    .refine((u) => u === "" || /^https:\/\/\S+$/.test(u), "Tracking link must start with https://")
    .optional(),
});

/**
 * The merchant shipped it another way. Replaces a failed supplier fulfilment if there is one,
 * otherwise records a new one, then emails the buyer.
 */
export async function addManualTracking(ctx: FulfillmentContext, shopId: string, orderId: string, input: z.input<typeof trackingInput>) {
  const parsed = trackingInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { carrier, trackingNumber, url } = parsed.data;
  const { db } = ctx;
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  if (order.paymentStatus !== "paid") throw new UserError("Only paid orders can be marked as shipped.");
  const t = now(ctx);
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
  const failedRow = await db.query.fulfillments.findFirst({
    where: and(eq(schema.fulfillments.orderId, order.id), eq(schema.fulfillments.status, "failed")),
  });
  if (failedRow) {
    // The supplier never got this one, so it stops being synced with them.
    await db.update(schema.fulfillments).set({ ...values, supplierOrderRef: null }).where(eq(schema.fulfillments.id, failedRow.id));
  } else {
    await db.insert(schema.fulfillments).values({ ...values, shopId, orderId: order.id, supplierId: null });
  }
  await refreshOrderFulfillment(db, order.id, t);
  await sendOrderEmail(ctx, order.id, "shipping_update");
}

/**
 * Ask suppliers for tracking on open fulfilments. Run on a schedule and from the "check now"
 * button. Emails the buyer once when a parcel ships and once when it's delivered.
 */
export async function syncTracking(ctx: FulfillmentContext, scope: { orderId?: string; limit?: number } = {}) {
  const { db } = ctx;
  const open = await db.query.fulfillments.findMany({
    where: and(
      inArray(schema.fulfillments.status, ["placed", "shipped"]),
      isNotNull(schema.fulfillments.supplierOrderRef),
      isNotNull(schema.fulfillments.supplierId),
      // Own suppliers report shipping themselves; only their unshipped orders are watched for lateness.
      sql`not (${schema.fulfillments.status} = 'shipped' and ${schema.fulfillments.supplierId} in (select id from ${schema.suppliers} where provider = 'email'))`,
      scope.orderId ? eq(schema.fulfillments.orderId, scope.orderId) : undefined,
    ),
    orderBy: [sql`${schema.fulfillments.lastCheckedAt} asc nulls first`, asc(schema.fulfillments.createdAt)],
    limit: scope.limit ?? 100,
  });
  const result = { checked: 0, shipped: 0, delivered: 0, late: 0, errors: 0 };
  for (const f of open) {
    result.checked++;
    const t = now(ctx);
    const link = await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, f.supplierId!) });
    let tracking: Awaited<ReturnType<ReturnType<Suppliers["get"]>["getTracking"]>> = null;
    try {
      if (!link) throw new SupplierError("not_connected", "Supplier connection was removed.");
      if (link.provider !== "email") tracking = await ctx.suppliers.get(link.provider).getTracking(f.supplierOrderRef!);
    } catch {
      result.errors++;
      await db.update(schema.fulfillments).set({ lastCheckedAt: t }).where(eq(schema.fulfillments.id, f.id));
      continue;
    }

    const patch: Partial<Fulfillment> = { lastCheckedAt: t, updatedAt: t };
    let email: "shipping_update" | "delivered" | null = null;
    if (tracking) {
      Object.assign(patch, { carrier: tracking.carrier, trackingNumber: tracking.trackingNumber, trackingUrl: tracking.url });
      if (f.problemCode === "late_shipment") Object.assign(patch, { problemCode: null, problemMessage: null });
      if (f.status === "placed") {
        patch.status = "shipped";
        patch.shippedAt = t;
        email = "shipping_update";
        result.shipped++;
      }
      if (tracking.status === "delivered") {
        patch.status = "delivered";
        patch.deliveredAt = t;
        email = "delivered";
        result.delivered++;
      }
    } else if (f.status === "placed" && !f.problemCode && f.placedAt && t.getTime() - f.placedAt.getTime() > LATE_AFTER_DAYS * 86_400_000) {
      patch.problemCode = "late_shipment";
      patch.problemMessage = `The supplier hasn't shipped this ${LATE_AFTER_DAYS} days after the order was placed.`;
      result.late++;
    }
    await db.update(schema.fulfillments).set(patch).where(eq(schema.fulfillments.id, f.id));
    await refreshOrderFulfillment(db, f.orderId, t);
    if (email === "delivered" && f.status === "placed") await sendOrderEmail(ctx, f.orderId, "shipping_update");
    if (email) await sendOrderEmail(ctx, f.orderId, email);
  }
  return result;
}

/**
 * Safety net for the scheduled job: paid orders whose routing never ran (for example the server
 * restarted right after the payment webhook).
 */
export async function routeStuckOrders(ctx: FulfillmentContext, olderThanMs = 2 * 60_000) {
  const cutoff = new Date(now(ctx).getTime() - olderThanMs);
  const rows = await ctx.db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .leftJoin(schema.fulfillments, eq(schema.fulfillments.orderId, schema.orders.id))
    .where(
      and(
        eq(schema.orders.paymentStatus, "paid"),
        eq(schema.orders.fulfillmentStatus, "unfulfilled"),
        lt(schema.orders.paidAt, cutoff),
        isNull(schema.orders.heldAt),
        isNull(schema.fulfillments.id),
        // Pre-orders still waiting for stock aren't stuck; they go once it's back.
        sql`not exists (select 1 from ${schema.orderLines} ol join ${schema.variants} v on v.id = ol.variant_id where ol.order_id = ${schema.orders.id} and ol.preorder and v.stock is not null and v.stock <= 0)`,
      ),
    )
    .limit(100);
  let routed = 0;
  for (const r of rows) {
    const res = await routeAndIssue(ctx, r.id);
    if (res.placed || res.failed) routed++;
  }
  return { routed };
}

// Emails --------------------------------------------------------------------------------------

type EmailKind = (typeof schema.emails.$inferSelect)["kind"];

/** What each order email is called on the order's timeline and in dispute evidence. */
export const ORDER_EMAIL_LABELS: Record<EmailKind, string> = {
  order_confirmation: "Order confirmation",
  shipping_update: "Shipping update",
  delivered: "Delivery confirmation",
  refund: "Refund",
  support_reply: "Reply to a question",
  abandoned_cart: "Checkout reminder",
  abandoned_cart_offer: "Second checkout reminder (with a code)",
  payment_link: "Payment link",
  gift_shipped: "Gift heads-up",
  order_link: "Order link (Track your order)",
  order_updated: "Order change",
  pickup_ready: "Ready for pickup",
  bank_transfer: "How to pay by bank transfer",
  bank_transfer_lapsed: "Bank transfer didn't arrive",
  order_news: "Update from you",
  order_late: "Running late",
  handover_reminder: "Pickup or delivery reminder (the day before)",
  handover_moved: "New pickup or delivery day",
};

async function buildEmail(ctx: FulfillmentContext, order: Order, shop: Shop, kind: EmailKind, ref: string) {
  const link = await ctx.orderStatusUrl(shop, order);
  // On a gift the address is the recipient's, so the buyer is greeted by the name they gave.
  const first = (order.gift?.from ?? order.shippingAddress.name).split(" ")[0];
  if (kind === "gift_shipped") {
    const gift = order.gift!;
    const shipped = await ctx.db.query.fulfillments.findMany({
      where: and(eq(schema.fulfillments.orderId, order.id), isNotNull(schema.fulfillments.trackingNumber)),
    });
    const returnCode = shop.returnWindowDays ? await giftReturnCode(ctx.db, order) : null;
    const returnsAt = ctx.storeAddress ? await ctx.storeAddress(shop) : new URL(link).origin;
    return {
      to: gift.recipientEmail!,
      subject: `${gift.from} sent you a gift from ${shop.name}`,
      text: [
        `Hi ${order.shippingAddress.name.split(" ")[0]},`,
        ``,
        `${gift.from} sent you a gift from ${shop.name}, and it's on its way.`,
        ...(gift.message ? [``, `Their message:`, gift.message] : []),
        ...(shipped.length ? [``, `Track it:`, ...shipped.map((f) => `  ${f.carrier}: ${f.trackingNumber}${f.trackingUrl ? `  ${f.trackingUrl}` : ""}`)] : []),
        ...(returnCode ? [``, `Not quite right? You can return it for store credit at ${returnsAt}/gift-return with the code ${returnCode}. ${gift.from} won't be told.`] : []),
        ``,
        `${gift.from} asked us to let you know. We won't email you about anything else.`,
      ].join("\n"),
    };
  }
  if (kind === "order_link") {
    return {
      subject: `Your order #${order.number} from ${shop.name}`,
      text: [
        `Hi ${first},`,
        ``,
        `Here's the link to your order #${order.number}, where you can see where it is, track it and ask us anything about it:`,
        ``,
        link,
        ``,
        `You asked for this on our "Track your order" page. If it wasn't you, you can ignore this email.`,
      ].join("\n"),
    };
  }
  if (kind === "bank_transfer" || kind === "bank_transfer_lapsed") {
    const lines = await ctx.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    const due = buyerAmounts(order, lines);
    const amount = formatMoney(due.chargedMinor, due.currency);
    const pay = ctx.payUrl ? await ctx.payUrl(shop, order) : link;
    const by = new Date((order.manualPaymentAt ?? now(ctx)).getTime() + (shop.bankTransfer?.days ?? 7) * 24 * 60 * 60 * 1000);
    const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(by);
    if (kind === "bank_transfer_lapsed") {
      return {
        subject: `We didn't get your payment for order #${order.number}`,
        text: [
          `Hi ${first},`,
          ``,
          `Your bank transfer of ${amount} for order #${order.number} hasn't reached ${shop.name}, so the order is no longer being held for you.`,
          ``,
          `If you've already sent it, reply to this email and we'll look out for it. Or pay by card now: ${pay}`,
        ].join("\n"),
      };
    }
    return {
      subject: `How to pay for your order #${order.number}`,
      text: [
        `Hi ${first},`,
        ``,
        `Thanks for your order from ${shop.name}. To finish it, send ${amount} by bank transfer to:`,
        ``,
        ...(shop.bankTransfer?.details ?? "").split("\n").map((l) => `  ${l}`),
        ``,
        `Reference: Order ${order.number}`,
        ``,
        `Please put the reference on the transfer so we can match it, and send it by ${day}. We'll email you when it arrives and start on your order then.`,
        ``,
        `Your order: ${link}`,
        `Rather pay by card? ${pay}`,
      ].join("\n"),
    };
  }
  if (kind === "payment_link") {
    const lines = await ctx.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    const paid = buyerAmounts(order, lines);
    const pay = ctx.payUrl ? await ctx.payUrl(shop, order) : link;
    return {
      subject: `Your order from ${shop.name} is ready to pay`,
      text: [
        `Hi ${first},`,
        ``,
        `${shop.name} put together this order for you:`,
        ``,
        ...lines.flatMap((l, n) => [`  ${l.title} × ${l.quantity}  ${formatMoney(paid.lines[n]!, paid.currency)}`, ...personalised(l)]),
        ``,
        `Total: ${formatMoney(paid.totalMinor, paid.currency)}, including shipping${order.taxMinor && !order.taxIncluded ? " and tax" : ""}`,
        ...(order.note ? [``, `A note from ${shop.name}:`, order.note] : []),
        ``,
        `Pay securely here: ${pay}`,
        ``,
        `Once you've paid, we'll email your receipt and tracking as it ships. If you didn't ask for this, you can ignore this email.`,
      ].join("\n"),
    };
  }
  if (kind === "abandoned_cart") {
    const lines = await ctx.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    const paid = buyerAmounts(order, lines);
    const pay = ctx.payUrl ? await ctx.payUrl(shop, order) : link;
    return {
      subject: `You left something at ${shop.name}`,
      text: [
        `Hi ${first},`,
        ``,
        `You started checking out at ${shop.name} but didn't finish. Your cart is saved:`,
        ``,
        ...lines.flatMap((l, n) => [`  ${l.title} × ${l.quantity}  ${formatMoney(paid.lines[n]!, paid.currency)}`, ...personalised(l)]),
        ``,
        `Total: ${formatMoney(paid.totalMinor, paid.currency)}`,
        ...(paid.giftCardMinor ? [`Left to pay after your gift card: ${formatMoney(paid.chargedMinor, paid.currency)}`] : []),
        ...(await holidayReminder(ctx.db, shop, order, lines)),
        ``,
        `Finish your order: ${pay}`,
        ``,
        `If you changed your mind, there's nothing to do. We won't email you about it again.`,
      ].join("\n"),
    };
  }
  if (kind === "abandoned_cart_offer") {
    const code = await ctx.db.query.discounts.findFirst({ where: and(eq(schema.discounts.shopId, shop.id), eq(schema.discounts.code, ref)) });
    if (!code) throw new NotFoundError("Discount code");
    const lines = await ctx.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    const pay = ctx.payUrl ? await ctx.payUrl(shop, order) : link;
    const until = code.endsAt!.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
    return {
      subject: `${code.value}% off what you left at ${shop.name}`,
      text: [
        `Hi ${first},`,
        ``,
        `Your cart at ${shop.name} is still saved:`,
        ``,
        ...lines.flatMap((l) => [`  ${l.title} × ${l.quantity}`, ...personalised(l)]),
        ``,
        `Here's ${code.value}% off if you'd like to finish your order:`,
        ``,
        `    ${code.code}`,
        ``,
        `It works once, with this email address, until ${until}.`,
        ...(await holidayReminder(ctx.db, shop, order, lines)),
        ``,
        `Back to your cart, with the code added: ${pay}/cart?code=${code.code}`,
        ``,
        `This is the last email about this cart.`,
      ].join("\n"),
    };
  }
  if (kind === "order_updated") {
    const edit = order.edits[Number(ref)];
    if (!edit) throw new NotFoundError("Order change");
    const a = order.shippingAddress;
    return {
      subject: `Your order #${order.number} was updated`,
      text: [
        `Hi ${first},`,
        ``,
        edit.by === "buyer" ? `Here's the change you made to your order #${order.number}:` : `${shop.name} changed your order #${order.number}:`,
        ``,
        ...edit.changes.map((c) => `  ${c}`),
        ``,
        `It ships to:`,
        ...[a.name, a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(" "), a.region, a.country].filter(Boolean).map((l) => `  ${l}`),
        ``,
        `See your order: ${link}`,
        ``,
        edit.by === "buyer" ? `If you didn't make this change, reply to this email right away.` : `If something looks wrong, reply to this email.`,
      ].join("\n"),
    };
  }
  if (kind === "refund") {
    const refund = await ctx.db.query.refunds.findFirst({ where: eq(schema.refunds.id, ref) });
    if (!refund) throw new NotFoundError("Refund");
    const full = order.refundedMinor >= order.totalMinor;
    const note = await ctx.db.query.invoices.findFirst({ where: eq(schema.invoices.refundId, refund.id) });
    const toGift = refund.giftCardMinor;
    const toCardMinor = refund.amountMinor - toGift;
    const where =
      toGift && toCardMinor
        ? `${formatMoney(toCardMinor, order.currency)} to the card you paid with and ${formatMoney(toGift, order.currency)} back onto your gift card`
        : toGift
          ? `${formatMoney(toGift, order.currency)} back onto your gift card`
          : null;
    return {
      subject: `Refund for order #${order.number}`,
      text: [
        `Hi ${first},`,
        ``,
        where
          ? `${shop.name} refunded ${where}${full ? " (the whole order)" : ""}.`
          : `${shop.name} refunded ${refund.presentmentAmountMinor != null && order.presentment ? formatMoney(refund.presentmentAmountMinor, order.presentment.currency) : formatMoney(refund.amountMinor, order.currency)} to the card you paid with${full ? " (the whole order)" : ""}.`,
        ...(refund.reason ? [``, `Reason: ${refund.reason}`] : []),
        ``,
        toCardMinor ? `Banks usually show card refunds within 5 to 10 business days.` : `You can use the gift card again right away.`,
        ...(note ? [``, `Credit note ${note.number}: ${link}/invoice?doc=${note.id}`] : []),
        ``,
        `Order status: ${link}`,
      ].join("\n"),
    };
  }
  if (kind === "order_confirmation" && order.source === "replacement") {
    const lines = await ctx.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    const original = order.replacesOrderId ? await ctx.db.query.orders.findFirst({ where: eq(schema.orders.id, order.replacesOrderId), columns: { number: true } }) : null;
    return {
      subject: `A replacement for order #${original?.number ?? order.number} is on its way`,
      text: [
        `Hi ${first},`,
        ``,
        `${shop.name} is sending you a replacement${original ? ` for order #${original.number}` : ""}, at no charge:`,
        ``,
        ...lines.flatMap((l) => [`  ${l.title} × ${l.quantity}`, ...personalised(l)]),
        ...(order.note ? [``, `From ${shop.name}: ${order.note}`] : []),
        ``,
        `It's order #${order.number}. We'll email you again when it ships. Track it any time: ${link}`,
      ].join("\n"),
    };
  }
  if (kind === "order_confirmation") {
    const lines = await ctx.db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
    const parentNumber = order.parentOrderId ? (await ctx.db.query.orders.findFirst({ where: eq(schema.orders.id, order.parentOrderId), columns: { number: true } }))?.number : null;
    const invoice = await ctx.db.query.invoices.findFirst({ where: and(eq(schema.invoices.orderId, order.id), eq(schema.invoices.kind, "invoice")) });
    const paid = buyerAmounts(order, lines);
    const downloads = await orderDownloads(ctx.db, order.id);
    const onlyDownloads = downloads.length > 0 && (await nothingToShip(ctx.db, order.id));
    const arrives = onlyDownloads ? null : await orderDelivery(ctx.db, shop, order);
    return {
      subject: `Order #${order.number} confirmed`,
      text: [
        `Hi ${first},`,
        ``,
        `Thanks for your order from ${shop.name}. Here's what you bought:`,
        ``,
        ...lines.flatMap((l, n) => [`  ${l.title} × ${l.quantity}  ${formatMoney(paid.lines[n]!, paid.currency)}`, ...personalised(l)]),
        ``,
        `${paid.giftCardMinor ? "Total" : "Total paid"}: ${formatMoney(paid.totalMinor, paid.currency)}`,
        ...(paid.giftCardMinor
          ? [`Paid with gift card: ${formatMoney(paid.giftCardMinor, paid.currency)}`, ...(paid.chargedMinor ? [`Paid by card: ${formatMoney(paid.chargedMinor, paid.currency)}`] : [])]
          : []),
        ...(paid.giftWrapMinor ? [`Includes gift wrapping: ${formatMoney(paid.giftWrapMinor, paid.currency)}`] : []),
        ...(paid.tipMinor ? [`Includes a tip: ${formatMoney(paid.tipMinor, paid.currency)}`] : []),
        ...(downloads.length
          ? [``, `Your download${downloads.length > 1 ? "s" : ""} (each link works ${DOWNLOADS_PER_ITEM} times for every one you bought):`, ...downloads.map((d) => `  ${d.title}: ${link}/download/${d.lineId}`)]
          : []),
        ...(invoice ? [``, `Your invoice ${invoice.number}: ${link}/invoice`] : []),
        ...(paid.protectionMinor
          ? [``, `Delivery protection (${formatMoney(paid.protectionMinor, paid.currency)}): if it's lost or arrives damaged, tell ${shop.name} from your order page and they'll send it again for free.`]
          : []),
        ...(order.preorderShipsBy ? [``, `Pre-order: it ships by ${formatShipsBy(order.preorderShipsBy)}. We'll email tracking as soon as it's on its way.`] : []),
        ...(arrives ? [``, `Expected delivery: ${formatDeliveryWindow(arrives)}.`] : []),
        ...(order.gift
          ? [
              ``,
              `It's a gift for ${order.shippingAddress.name}.${order.gift.recipientEmail ? ` We'll email ${order.gift.recipientEmail} when it ships${order.gift.message ? ", with your message" : ""} and tracking, but no prices.` : ""}`,
              ...(order.gift.message ? [`Your message: ${order.gift.message}`] : []),
            ]
          : []),
        ...(order.buyerNote ? [``, `Your note to ${shop.name}: ${order.buyerNote}`] : []),
        ...(order.parentOrderId ? [``, `You added this after checkout, so it's charged to the same card. It may arrive separately from order #${parentNumber}.`] : []),
        ...(order.source === "subscription" ? [``, `This is a delivery from your subscription, charged to your saved card. The link in your subscription emails lets you skip, change or cancel the next one.`] : []),
        ...(shop.thankYouNote ? [``, shop.thankYouNote] : []),
        ``,
        onlyDownloads
          ? `There's nothing to ship. Your downloads are also on your order page: ${link}`
          : order.pickup
          ? `You're picking it up from ${shop.name}. We'll email you when it's ready, with the address. See your order any time: ${link}`
          : order.localDelivery
            ? `${shop.name} is delivering it to you themselves${shop.localDeliveryArea?.note ? ` (${shop.localDeliveryArea.note})` : ""}. See your order any time: ${link}`
            : `We'll email you again when it ships. Track your order any time: ${link}`,
      ].join("\n"),
    };
  }
  if (kind === "pickup_ready") {
    const pickup = shop.localPickup;
    return {
      subject: `Order #${order.number} is ready to pick up`,
      text: [
        `Hi ${first},`,
        ``,
        `Your order from ${shop.name} is ready. Pick it up from:`,
        ``,
        ...(pickup?.address ?? "").split("\n").map((l) => `  ${l}`),
        ...(pickup?.instructions ? [``, pickup.instructions] : []),
        ``,
        `Bring your order number, #${order.number}. Order status: ${link}`,
      ].join("\n"),
    };
  }
  const shipped = await ctx.db.query.fulfillments.findMany({
    where: and(eq(schema.fulfillments.orderId, order.id), isNotNull(schema.fulfillments.trackingNumber)),
  });
  const tracking = shipped.map((f) => `  ${f.carrier}: ${f.trackingNumber}${f.trackingUrl ? `  ${f.trackingUrl}` : ""}`);
  if (kind === "shipping_update") {
    return {
      subject: `Order #${order.number} is on its way`,
      text: [`Hi ${first},`, ``, `Good news: your order from ${shop.name} has shipped.`, ``, ...tracking, ``, `Order status: ${link}`].join("\n"),
    };
  }
  return {
    subject: `Order #${order.number} was ${order.pickup ? "picked up" : "delivered"}`,
    text: [
      `Hi ${first},`,
      ``,
      order.pickup ? `Thanks for picking up your order from ${shop.name}. We hope you love it.` : `Your order from ${shop.name} was delivered. We hope you love it.`,
      ``,
      `If anything's wrong, reply to this email. If you like it, a short review helps other buyers: ${link}#review`,
      ``,
      `Order status: ${link}`,
    ].join("\n"),
  };
}

/**
 * Send one kind of email for an order at most once (per `ref`, e.g. one per refund).
 * Failures are recorded, not thrown.
 */
export async function sendOrderEmail(ctx: FulfillmentContext, orderId: string, kind: EmailKind, ref = "") {
  const { db } = ctx;
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.id, orderId) });
  if (!order) throw new NotFoundError("Order");
  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, order.shopId) }))!;
  if (kind === "gift_shipped" && !order.gift?.recipientEmail) return { status: "not_needed" as const };
  const email = await buildEmail(ctx, order, shop, kind, ref);
  const result = await deliverOrderEmail(ctx, shop, order, kind, ref, { to: ("to" in email && email.to) || order.email, subject: email.subject, text: email.text });
  // The gift's recipient hears once, when the buyer does.
  if (result.status === "sent" && kind === "shipping_update" && order.gift?.recipientEmail) await sendOrderEmail(ctx, order.id, "gift_shipped");
  return result;
}

/** Records an order's email once per kind and ref, then sends it; a repeat is skipped. */
export async function deliverOrderEmail(ctx: FulfillmentContext, shop: Shop, order: Order, kind: EmailKind, ref: string, email: { to: string; subject: string; text: string }) {
  const { db } = ctx;
  const { to, subject, text } = email;
  const [row] = await db
    .insert(schema.emails)
    .values({ shopId: shop.id, orderId: order.id, kind, ref, to, subject, bodyText: text })
    .onConflictDoNothing()
    .returning({ id: schema.emails.id });
  if (!row) return { status: "already_sent" as const };
  try {
    const { id } = await ctx.mailer.send({ to, subject, text });
    await db.update(schema.emails).set({ status: "sent", providerMessageId: id, sentAt: now(ctx) }).where(eq(schema.emails.id, row.id));
    return { status: "sent" as const };
  } catch (e) {
    await db
      .update(schema.emails)
      .set({ status: "failed", error: e instanceof Error ? e.message : String(e) })
      .where(eq(schema.emails.id, row.id));
    return { status: "failed" as const };
  }
}

/** The longest update a merchant can email to buyers. */
export const ORDER_UPDATE_MAX = 1000;

/**
 * Emails the buyers of the picked orders the same update in the merchant's words, say that the
 * supplier is running late or that the shop is closed for a week. Each email greets the buyer by
 * name, names their order and links to it, and shows on the order's timeline. Only paid orders that
 * weren't fully refunded get one; the rest are counted as skipped.
 */
export async function emailOrderUpdate(ctx: FulfillmentContext, shopId: string, orderIds: string[], input: { message: string }) {
  const message = input.message.trim().replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  if (!message) throw new UserError("Write the update for your buyers.");
  if (message.length > ORDER_UPDATE_MAX) throw new UserError(`Keep the update under ${ORDER_UPDATE_MAX.toLocaleString("en-US")} characters.`);
  const ids = [...new Set(orderIds)].filter((id) => z.string().uuid().safeParse(id).success);
  if (!ids.length) throw new UserError("Pick at least one order.");
  if (ids.length > MAX_BULK_ORDERS) throw new UserError(`Pick up to ${MAX_BULK_ORDERS} orders at a time.`);
  const shop = await ctx.db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new NotFoundError("Store");
  const orders = await ctx.db.query.orders.findMany({ where: and(eq(schema.orders.shopId, shopId), inArray(schema.orders.id, ids)), orderBy: asc(schema.orders.number) });
  // One ref for the whole send, so a retried request doesn't email anyone twice.
  const ref = `update-${createHash("sha256").update(`${message}\n${[...ids].sort().join(",")}`).digest("hex").slice(0, 16)}`;
  let sent = 0;
  let failed = 0;
  let skipped = ids.length - orders.length;
  for (const order of orders) {
    if (!order.paidAt || !["paid", "partially_refunded"].includes(order.paymentStatus)) {
      skipped++;
      continue;
    }
    const first = order.shippingAddress.name.split(" ")[0];
    const result = await deliverOrderEmail(ctx, shop, order, "order_news", ref, {
      to: order.email,
      subject: `An update on your order #${order.number} from ${shop.name}`,
      text: [`Hi ${first},`, ``, message, ``, `Your order #${order.number}: ${await ctx.orderStatusUrl(shop, order)}`, ``, `Reply to this email if you have a question.`].join("\n"),
    });
    if (result.status === "sent") sent++;
    else if (result.status === "failed") failed++;
    else skipped++;
  }
  return { sent, failed, skipped };
}
