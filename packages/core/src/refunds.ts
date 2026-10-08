import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { refreshOrderFulfillment, sendOrderEmail, type FulfillmentContext } from "./fulfillment";
import { cancelPurchaseOrder, supplierLabel } from "./own-suppliers";
import type { PaymentProvider } from "./payments";

export type RefundContext = FulfillmentContext & { payments: PaymentProvider };

/**
 * Refund part or all of an order. Our sales fee is returned in proportion, so a merchant never
 * pays us for a sale they gave back. On a full refund, supplier orders that haven't shipped are
 * cancelled so the merchant isn't charged for goods the buyer won't get. An order paid partly
 * with a gift card is refunded to the card payment first, then back onto the gift card. A full
 * refund turns off gift cards bought on the order.
 */
export async function refundOrder(
  ctx: RefundContext,
  shopId: string,
  orderId: string,
  input: { amountMinor?: number; reason?: string | null },
) {
  const { db } = ctx;
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!order) throw new NotFoundError("Order");
  if (!["paid", "partially_refunded"].includes(order.paymentStatus) || !order.paymentIntentId) {
    throw new UserError("Only paid orders can be refunded.");
  }
  const left = order.totalMinor - order.refundedMinor;
  const amount = input.amountMinor ?? left;
  if (!Number.isInteger(amount) || amount <= 0) throw new UserError("Enter an amount to refund.");
  if (amount > left) throw new UserError(`You can refund at most ${(left / 100).toFixed(2)} on this order.`);
  const reason = input.reason?.trim().slice(0, 500) || null;

  // Reserve the amount first so two refunds pressed at once can't exceed the total.
  const [reserved] = await db
    .update(schema.orders)
    .set({ refundedMinor: sql`${schema.orders.refundedMinor} + ${amount}`, updatedAt: new Date() })
    .where(and(eq(schema.orders.id, order.id), sql`${schema.orders.refundedMinor} + ${amount} <= ${schema.orders.totalMinor}`))
    .returning();
  if (!reserved) throw new UserError("Someone else just refunded this order. Reload to see what's left.");

  const [{ toGiftAlready }] = (await db
    .select({ toGiftAlready: sql<number>`coalesce(sum(${schema.refunds.giftCardMinor}), 0)::int` })
    .from(schema.refunds)
    .where(eq(schema.refunds.orderId, order.id))) as [{ toGiftAlready: number }];
  const cardLeft = order.totalMinor - order.giftCardMinor - (order.refundedMinor - Number(toGiftAlready));
  const toCard = Math.min(amount, Math.max(cardLeft, 0));
  const toGift = amount - toCard;

  // A buyer who paid in another currency is refunded in it, at the rate they paid; refunding
  // everything left returns exactly what's left of their charge.
  let presentmentAmount: number | null = null;
  if (order.presentment) {
    const [{ done }] = (await db
      .select({ done: sql<number>`coalesce(sum(${schema.refunds.presentmentAmountMinor}), 0)::int` })
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, order.id))) as [{ done: number }];
    const presentLeft = order.presentment.totalMinor - Number(done);
    presentmentAmount = amount === left ? presentLeft : Math.min(presentLeft, Math.round(amount * order.presentment.rate));
  }

  let providerRefundId: string | null = null;
  try {
    if (toCard > 0) {
      ({ id: providerRefundId } = await ctx.payments.refund({ paymentIntentId: order.paymentIntentId, amountMinor: presentmentAmount ?? toCard, reason }));
    }
  } catch (e) {
    await db
      .update(schema.orders)
      .set({ refundedMinor: sql`${schema.orders.refundedMinor} - ${amount}` })
      .where(eq(schema.orders.id, order.id));
    throw e instanceof UserError ? e : new UserError(`The payment processor didn't accept the refund: ${e instanceof Error ? e.message : String(e)}`);
  }

  const full = reserved.refundedMinor >= reserved.totalMinor;
  const refund = await db.transaction(async (tx) => {
    const [{ already, taxAlready }] = (await tx
      .select({
        already: sql<number>`coalesce(sum(${schema.refunds.platformFeeRefundedMinor}), 0)::int`,
        taxAlready: sql<number>`coalesce(sum(${schema.refunds.taxRefundedMinor}), 0)::int`,
      })
      .from(schema.refunds)
      .where(eq(schema.refunds.orderId, order.id))) as [{ already: number; taxAlready: number }];
    // The last refund returns whatever fee is left, so rounding never keeps a cent.
    const feeBack = full
      ? order.platformFeeMinor - Number(already)
      : Math.min(Math.round((order.platformFeeMinor * amount) / order.totalMinor), order.platformFeeMinor - Number(already));
    // The tax in the refunded amount goes back to the buyer too, and comes off what the merchant owes.
    const taxBack = full
      ? order.taxMinor - Number(taxAlready)
      : Math.min(Math.round((order.taxMinor * amount) / order.totalMinor), order.taxMinor - Number(taxAlready));
    const [row] = await tx
      .insert(schema.refunds)
      .values({
        shopId,
        orderId: order.id,
        amountMinor: amount,
        platformFeeRefundedMinor: Math.max(feeBack, 0),
        taxRefundedMinor: Math.max(taxBack, 0),
        presentmentAmountMinor: presentmentAmount,
        giftCardMinor: toGift,
        reason,
        providerRefundId,
      })
      .returning();
    if (toGift > 0 && order.giftCardId) {
      await tx
        .update(schema.giftCards)
        .set({ balanceMinor: sql`least(${schema.giftCards.balanceMinor} + ${toGift}, ${schema.giftCards.initialMinor})` })
        .where(eq(schema.giftCards.id, order.giftCardId));
    }
    if (full) {
      await tx.update(schema.giftCards).set({ disabledAt: new Date() }).where(and(eq(schema.giftCards.sourceOrderId, order.id), isNull(schema.giftCards.disabledAt)));
    }
    await tx
      .update(schema.orders)
      .set({ paymentStatus: full ? "refunded" : "partially_refunded", updatedAt: new Date() })
      .where(eq(schema.orders.id, order.id));
    return row!;
  });

  const cancelled = full ? await cancelUnshipped(ctx, order.id) : { cancelled: 0, notCancelled: [] };
  const email = await sendOrderEmail(ctx, order.id, "refund", refund.id);
  return { refund, full, ...cancelled, email: email.status };
}

/** Stop supplier orders that haven't shipped. Ones the supplier won't cancel are reported back. */
async function cancelUnshipped(ctx: RefundContext, orderId: string) {
  const { db } = ctx;
  const open = await db.query.fulfillments.findMany({
    where: and(eq(schema.fulfillments.orderId, orderId), inArray(schema.fulfillments.status, ["pending", "failed", "placing", "placed"])),
  });
  let cancelled = 0;
  const notCancelled: { supplier: string; message: string }[] = [];
  for (const f of open) {
    if (f.status === "placing") {
      notCancelled.push({ supplier: "The supplier", message: "This order was being sent at that moment. Check it in a minute and cancel it with the supplier if it went through." });
      continue;
    }
    if (f.status !== "placed" || !f.supplierOrderRef) {
      // Never reached the supplier (or the attempt failed): just stop it from being sent.
      await db.update(schema.fulfillments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.fulfillments.id, f.id));
      cancelled++;
      continue;
    }
    const link = f.supplierId ? await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, f.supplierId) }) : undefined;
    const label = link ? supplierLabel(ctx.suppliers, link) : "The supplier";
    try {
      if (!link) throw new Error("This supplier is no longer connected.");
      const result =
        link.provider === "email"
          ? (await cancelPurchaseOrder(ctx, link, f), { cancelled: true, message: null })
          : await ctx.suppliers.get(link.provider).cancelOrder(f.supplierOrderRef);
      if (result.cancelled) {
        await db.update(schema.fulfillments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.fulfillments.id, f.id));
        cancelled++;
      } else {
        notCancelled.push({ supplier: label, message: result.message ?? "The supplier wouldn't cancel it." });
      }
    } catch (e) {
      notCancelled.push({ supplier: label, message: e instanceof Error ? e.message : String(e) });
    }
  }
  if (open.length) await refreshOrderFulfillment(db, orderId);
  return { cancelled, notCancelled };
}

export async function listRefunds(db: FulfillmentContext["db"], orderId: string) {
  return db.query.refunds.findMany({ where: eq(schema.refunds.orderId, orderId), orderBy: schema.refunds.createdAt });
}
