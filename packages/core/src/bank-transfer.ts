// Paying by bank transfer, for buyers who'd rather not use a card (common in Germany and the
// Netherlands, and for bigger orders). The buyer picks it on the payment page and is emailed the
// store's account details with the order number as the reference. Nothing is ordered from the
// supplier until the merchant sees the money arrive and presses Mark as paid; from then on it's an
// ordinary paid order. If nothing arrives in time the order lapses, and the buyer can still pay by
// card. Only on paid plans: the free plan's 2% is taken from card payments, which this skips.
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { schema, type BankTransfer, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { sendOrderEmail, type FulfillmentContext } from "./fulfillment";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;

export const BANK_DETAILS_MAX = 600;
export const TRANSFER_DAYS = { min: 2, max: 30, default: 7 };
const DAY = 24 * 60 * 60 * 1000;

/** Turns bank transfers on with the account details and days to pay, or off (null). */
export async function setBankTransfer(db: Db, shop: Pick<Shop, "id" | "plan">, input: { details: string; days: number } | null) {
  let value: BankTransfer | null = null;
  if (input) {
    if (shop.plan === "free") throw new UserError("Bank transfers are on paid plans. On the free plan our 2% comes out of card payments, and a transfer skips the card.");
    const details = input.details.trim().replace(/\r\n/g, "\n");
    if (details.length < 10) throw new UserError("Write the account to pay into: the name on the account, and the IBAN or account and sort or routing number.");
    if (details.length > BANK_DETAILS_MAX) throw new UserError(`Keep the account details under ${BANK_DETAILS_MAX} characters.`);
    if (!Number.isInteger(input.days) || input.days < TRANSFER_DAYS.min || input.days > TRANSFER_DAYS.max) throw new UserError(`Give buyers ${TRANSFER_DAYS.min} to ${TRANSFER_DAYS.max} days to pay.`);
    value = { details, days: input.days };
  }
  await db.update(schema.shops).set({ bankTransfer: value, updatedAt: new Date() }).where(eq(schema.shops.id, shop.id));
  return value;
}

/** Whether this unpaid order can be paid by transfer: the store takes them, and it's priced in the store's own currency. */
export function canPayByTransfer(shop: Pick<Shop, "bankTransfer" | "plan">, order: Pick<Order, "paymentStatus" | "presentment" | "source" | "totalMinor" | "giftCardMinor">) {
  return !!shop.bankTransfer && shop.plan !== "free"
    && (order.paymentStatus === "pending" || order.paymentStatus === "failed")
    && !order.presentment
    && (order.source === "checkout" || order.source === "payment_link")
    && order.totalMinor - order.giftCardMinor > 0;
}

/** The day a transfer needs to arrive by. */
export function transferDueBy(shop: Pick<Shop, "bankTransfer">, order: Pick<Order, "manualPaymentAt">) {
  if (!order.manualPaymentAt) return null;
  return new Date(order.manualPaymentAt.getTime() + (shop.bankTransfer?.days ?? TRANSFER_DAYS.default) * DAY);
}

/** The buyer chose to pay by transfer: the order waits for it, and they're emailed how to pay. */
export async function chooseBankTransfer(ctx: FulfillmentContext, shopId: string, orderId: string) {
  const shop = await ctx.db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const order = await ctx.db.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
  if (!shop || !order) throw new NotFoundError("Order");
  if (order.manualPayment === "bank_transfer" && order.paymentStatus === "pending") return order;
  if (!canPayByTransfer(shop, order)) throw new UserError("This order can't be paid by bank transfer.");
  const at = ctx.now?.() ?? new Date();
  const [row] = await ctx.db
    .update(schema.orders)
    .set({ manualPayment: "bank_transfer", manualPaymentAt: at, paymentStatus: "pending", updatedAt: at })
    .where(and(eq(schema.orders.id, order.id), inArray(schema.orders.paymentStatus, ["pending", "failed"])))
    .returning();
  if (!row) throw new UserError("This order is already paid.");
  // A second choice after a lapse gets its own email.
  await sendOrderEmail(ctx, row.id, "bank_transfer", at.toISOString());
  return row;
}

/**
 * The merchant saw the transfer arrive. Returns true when this made the order paid, so the caller
 * runs what follows a payment (confirmation, supplier order, stock). A late transfer still counts.
 */
export async function markTransferPaid(db: Db, shopId: string, orderId: string) {
  return db.transaction(async (tx) => {
    const order = await tx.query.orders.findFirst({ where: and(eq(schema.orders.id, orderId), eq(schema.orders.shopId, shopId)) });
    if (!order) throw new NotFoundError("Order");
    if (order.manualPayment !== "bank_transfer") throw new UserError("This order isn't waiting for a bank transfer.");
    const [paid] = await tx
      .update(schema.orders)
      .set({ paymentStatus: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.orders.id, order.id), inArray(schema.orders.paymentStatus, ["pending", "failed"])))
      .returning({ id: schema.orders.id });
    if (!paid) return false;
    // The gift card part is spent now, as it is when a card payment goes through.
    if (order.giftCardId && order.giftCardMinor) {
      await tx
        .update(schema.giftCards)
        .set({ balanceMinor: sql`greatest(${schema.giftCards.balanceMinor} - ${order.giftCardMinor}, 0)` })
        .where(eq(schema.giftCards.id, order.giftCardId));
    }
    return true;
  });
}

/** Transfers that didn't arrive in time: the order stops waiting and the buyer is told they can pay by card. */
export async function lapseBankTransfers(ctx: FulfillmentContext, now = ctx.now?.() ?? new Date()) {
  const waiting = await ctx.db
    .select({ order: schema.orders, days: sql<number | null>`(${schema.shops.bankTransfer}->>'days')::int` })
    .from(schema.orders)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
    .where(and(eq(schema.orders.manualPayment, "bank_transfer"), eq(schema.orders.paymentStatus, "pending"), isNotNull(schema.orders.manualPaymentAt), lt(schema.orders.manualPaymentAt, new Date(now.getTime() - TRANSFER_DAYS.min * DAY))))
    .limit(500);
  let lapsed = 0;
  for (const { order, days } of waiting) {
    if (order.manualPaymentAt!.getTime() + (days ?? TRANSFER_DAYS.default) * DAY > now.getTime()) continue;
    const [row] = await ctx.db
      .update(schema.orders)
      .set({ paymentStatus: "failed", updatedAt: now })
      .where(and(eq(schema.orders.id, order.id), eq(schema.orders.paymentStatus, "pending")))
      .returning({ id: schema.orders.id });
    if (!row) continue;
    lapsed++;
    await sendOrderEmail(ctx, order.id, "bank_transfer_lapsed", order.manualPaymentAt!.toISOString());
  }
  return { lapsed };
}

/** Orders waiting on a bank transfer, for the Orders page. */
export async function countWaitingTransfers(db: Db, shopId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.orders.manualPayment, "bank_transfer"), eq(schema.orders.paymentStatus, "pending")));
  return row?.n ?? 0;
}

/** The ways a buyer can pay this store, in the order the footer shows them. Cards and wallets come through Stripe. */
export function paymentMethods(shop: Pick<Shop, "bankTransfer" | "plan">) {
  const methods: ("visa" | "mastercard" | "amex" | "apple_pay" | "google_pay" | "bank_transfer")[] = ["visa", "mastercard", "amex", "apple_pay", "google_pay"];
  if (shop.bankTransfer && shop.plan !== "free") methods.push("bank_transfer");
  return methods;
}
