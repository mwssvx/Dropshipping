// Subscribe and save: right after paying, a buyer can have the same items sent again every few
// weeks for less, charged to the card kept from that order. Each delivery is its own order, placed
// by the scheduled job, so supplier, receipt, invoice and refunds work as for any order. Buyers
// hear three days before each charge and can skip, change, pause or cancel from a private link.
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { onOrderPaid, type FulfillmentContext } from "./fulfillment";
import { formatMoney } from "./money";
import { handlePaymentEvent, quoteCart, startCheckout } from "./orders";
import type { PaymentProvider } from "./payments";
import type { TaxCalculator } from "./tax";
import { percentOff } from "./wholesale";

type Shop = typeof schema.shops.$inferSelect;
type Order = typeof schema.orders.$inferSelect;
type Subscription = typeof schema.subscriptions.$inferSelect;

const DAY = 86_400_000;

export const SUBSCRIPTION_INTERVALS = [
  { days: 14, label: "Every 2 weeks" },
  { days: 30, label: "Every month" },
  { days: 60, label: "Every 2 months" },
] as const;

export function intervalLabel(days: number) {
  return SUBSCRIPTION_INTERVALS.find((i) => i.days === days)?.label ?? `Every ${days} days`;
}

/** How long after paying the order page still offers to subscribe. */
export const SUBSCRIBE_WITHIN_DAYS = 7;
/** The "coming up" email goes this many days before each charge. */
export const REMIND_DAYS = 3;
/** A failed charge is tried again after this many days, and the subscription pauses after this many failures in a row. */
const RETRY_DAYS = 2;
const MAX_FAILURES = 3;

export type SubscriptionContext = FulfillmentContext & {
  payments: PaymentProvider;
  /** The buyer's private page for managing a subscription. */
  manageUrl: (shop: Shop, token: string) => string | Promise<string>;
  taxCalculator?: TaxCalculator;
};

const offerInput = z.object({
  percentOff: z.number({ invalid_type_error: "Enter the percent off." }).int("Use a whole number.").min(0, "The discount can't be negative.").max(30, "Keep it to 30% off or less."),
  active: z.boolean(),
});

/** Turns "Subscribe and save" on or off. Subscriptions buyers already have carry on either way. */
export async function setSubscriptionOffer(db: Db, shopId: string, input: z.input<typeof offerInput>) {
  const parsed = offerInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  await db.update(schema.shops).set({ subscriptionOffer: parsed.data }).where(eq(schema.shops.id, shopId));
  return parsed.data;
}

/** The goods on an order that can be sent again: products still on sale, not gift cards. */
async function repeatableLines(db: Db, orderId: string) {
  const rows = await db
    .select({ variantId: schema.orderLines.variantId, quantity: schema.orderLines.quantity })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.orderLines.orderId, orderId), eq(schema.products.status, "active"), eq(schema.products.giftCard, false), isNull(schema.orderLines.addonId)));
  // One line per option, in case the order had the same thing twice.
  const merged = new Map<string, number>();
  for (const r of rows) merged.set(r.variantId!, Math.min(99, (merged.get(r.variantId!) ?? 0) + r.quantity));
  return [...merged].map(([variantId, quantity]) => ({ variantId, quantity }));
}

/** What one delivery costs today: the items at the subscription price, plus shipping (tax on top where it applies). */
async function priceDelivery(db: Db, shop: Shop, lines: { variantId: string; quantity: number }[], country: string, percent: number) {
  const quote = await quoteCart(db, shop, lines, { country });
  const items = quote.items.map((i) => ({ variantId: i.variantId, title: i.title, quantity: i.quantity, priceMinor: i.unitPriceMinor, offerMinor: percentOff(i.unitPriceMinor, percent) }));
  const goodsMinor = items.reduce((s, i) => s + i.offerMinor * i.quantity, 0);
  return { items, goodsMinor, shippingMinor: quote.shippingMinor, eachMinor: goodsMinor + quote.shippingMinor };
}

export type SubscriptionOfferView = Awaited<ReturnType<typeof priceDelivery>> & { percentOff: number; intervals: typeof SUBSCRIPTION_INTERVALS };

/**
 * The offer to show on an order's page, or null: the store has it on, the order was paid at checkout
 * by a card kept for it in the last week, it isn't subscribed yet, and its goods can be sent again.
 */
export async function subscriptionOfferFor(db: Db, shop: Shop, order: Order, opts: { now?: Date } = {}): Promise<SubscriptionOfferView | null> {
  const offer = shop.subscriptionOffer;
  const now = opts.now ?? new Date();
  if (!offer?.active || !order.cardSaved || order.paymentStatus !== "paid" || !order.paidAt || order.source !== "checkout") return null;
  if (now.getTime() > order.paidAt.getTime() + SUBSCRIBE_WITHIN_DAYS * DAY) return null;
  if (await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.firstOrderId, order.id), columns: { id: true } })) return null;
  const lines = await repeatableLines(db, order.id);
  if (!lines.length) return null;
  try {
    return { ...(await priceDelivery(db, shop, lines, order.shippingAddress.country, offer.percentOff)), percentOff: offer.percentOff, intervals: SUBSCRIPTION_INTERVALS };
  } catch (e) {
    // Sold out or no longer shipped there: nothing to offer.
    if (e instanceof UserError) return null;
    throw e;
  }
}

const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
export const formatDeliveryDate = (d: Date) => day.format(d);

function itemList(items: { title: string; quantity: number }[]) {
  return items.map((i) => `- ${i.quantity} × ${i.title}`).join("\n");
}

/** The buyer subscribed from their order page. The first repeat delivery is one interval after today. */
export async function startSubscription(
  ctx: Pick<SubscriptionContext, "db" | "mailer" | "manageUrl">,
  shop: Shop,
  input: { orderRef: string; intervalDays: number },
  opts: { now?: Date } = {},
) {
  const { db } = ctx;
  const now = opts.now ?? new Date();
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, shop.id), eq(schema.orders.paymentIntentId, input.orderRef)) });
  if (!order) throw new NotFoundError("Order");
  const offer = await subscriptionOfferFor(db, shop, order, { now });
  if (!offer) {
    if (await subscriptionForOrder(db, order.id)) throw new UserError("You're already subscribed to this order.", "already_subscribed");
    throw new UserError("This offer has ended.", "offer_ended");
  }
  if (!SUBSCRIPTION_INTERVALS.some((i) => i.days === input.intervalDays)) throw new UserError("Pick how often you'd like it.");
  const lines = await repeatableLines(db, order.id);
  let sub: Subscription;
  try {
    [sub] = (await db
      .insert(schema.subscriptions)
      .values({
        shopId: shop.id,
        customerId: order.customerId,
        email: order.email,
        token: randomBytes(18).toString("base64url"),
        firstOrderId: order.id,
        lines,
        shippingAddress: order.shippingAddress,
        intervalDays: input.intervalDays,
        percentOff: offer.percentOff,
        nextOrderAt: new Date(now.getTime() + input.intervalDays * DAY),
      })
      .returning()) as [Subscription];
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("You're already subscribed to this order.", "already_subscribed");
    throw e;
  }
  await ctx.mailer.send({
    to: sub.email,
    subject: `You're subscribed to ${shop.name}`,
    text: [
      `Hi ${order.shippingAddress.name.split(" ")[0]},`,
      ``,
      `${intervalLabel(sub.intervalDays)}, we'll send you:`,
      itemList(offer.items),
      ``,
      `Each delivery is ${sub.percentOff}% off the price at the time, charged to the card you paid with for order #${order.number}. Shipping and any tax are added as at checkout.`,
      `First repeat delivery: ${formatDeliveryDate(sub.nextOrderAt)}.`,
      ``,
      `We'll email you ${REMIND_DAYS} days before each charge. Skip a delivery, change how often, pause or cancel any time here:`,
      await ctx.manageUrl(shop, sub.token),
    ].join("\n"),
  });
  return sub;
}

/** The subscription started from this order, if any. */
export async function subscriptionForOrder(db: Db, orderId: string) {
  return (await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.firstOrderId, orderId) })) ?? null;
}

export type SubscriptionView = Awaited<ReturnType<typeof viewSubscription>>;

/** A subscription with its items at today's prices and the deliveries so far, newest first. */
async function viewSubscription(db: Db, shop: Shop, sub: Subscription) {
  const variants = await db
    .select({ id: schema.variants.id, title: schema.variants.title, priceMinor: schema.variants.priceMinor, product: schema.products.title, status: schema.products.status })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(inArray(schema.variants.id, sub.lines.map((l) => l.variantId)));
  const items = sub.lines.map((l) => {
    const v = variants.find((x) => x.id === l.variantId);
    const priceMinor = v?.priceMinor ?? 0;
    return {
      variantId: l.variantId,
      title: !v ? "An item that's no longer sold" : v.title === "Default" ? v.product : `${v.product} (${v.title})`,
      quantity: l.quantity,
      priceMinor,
      offerMinor: percentOff(priceMinor, sub.percentOff),
      available: !!v && v.status === "active",
    };
  });
  const first = (await db.query.orders.findFirst({ where: eq(schema.orders.id, sub.firstOrderId), columns: { number: true, paymentIntentId: true } }))!;
  const orders = await db
    .select({ id: schema.orders.id, number: schema.orders.number, paymentIntentId: schema.orders.paymentIntentId, totalMinor: schema.orders.totalMinor, currency: schema.orders.currency, createdAt: schema.orders.createdAt, fulfillmentStatus: schema.orders.fulfillmentStatus })
    .from(schema.orders)
    .where(and(eq(schema.orders.subscriptionId, sub.id), ne(schema.orders.paymentStatus, "pending")))
    .orderBy(desc(schema.orders.createdAt));
  return { ...sub, shop: { name: shop.name, currency: shop.currency }, items, firstOrder: first, orders };
}

/** The buyer's page, by the private token in their emails. */
export async function getSubscriptionByToken(db: Db, shop: Shop, token: string) {
  const sub = await db.query.subscriptions.findFirst({ where: and(eq(schema.subscriptions.shopId, shop.id), eq(schema.subscriptions.token, token)) });
  if (!sub) throw new NotFoundError("Subscription");
  return viewSubscription(db, shop, sub);
}

/** A buyer's subscriptions, for their account page. */
export async function subscriptionsForEmail(db: Db, shopId: string, email: string) {
  return db.query.subscriptions.findMany({
    where: and(eq(schema.subscriptions.shopId, shopId), eq(schema.subscriptions.email, email.trim().toLowerCase())),
    orderBy: desc(schema.subscriptions.createdAt),
  });
}

export type SubscriptionChange =
  | { type: "skip" }
  | { type: "interval"; days: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" };

/** Skip, change how often, pause, resume or cancel, from the buyer's page. */
export async function changeSubscription(db: Db, shop: Shop, token: string, change: SubscriptionChange, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const sub = await db.query.subscriptions.findFirst({ where: and(eq(schema.subscriptions.shopId, shop.id), eq(schema.subscriptions.token, token)) });
  if (!sub) throw new NotFoundError("Subscription");
  if (sub.status === "cancelled") throw new UserError("This subscription was cancelled.");
  const soonest = new Date(now.getTime() + DAY);
  let set: Partial<typeof schema.subscriptions.$inferInsert>;
  switch (change.type) {
    case "skip":
      if (sub.status !== "active") throw new UserError("Resume the subscription first.");
      set = { nextOrderAt: new Date(sub.nextOrderAt.getTime() + sub.intervalDays * DAY) };
      break;
    case "interval": {
      if (!SUBSCRIPTION_INTERVALS.some((i) => i.days === change.days)) throw new UserError("Pick how often you'd like it.");
      if (change.days === sub.intervalDays) return getSubscriptionByToken(db, shop, token);
      // The next delivery moves by the difference, but never to today or earlier.
      const moved = new Date(sub.nextOrderAt.getTime() + (change.days - sub.intervalDays) * DAY);
      set = { intervalDays: change.days, nextOrderAt: moved < soonest ? soonest : moved };
      break;
    }
    case "pause":
      if (sub.status === "paused") throw new UserError("It's already paused.");
      set = { status: "paused", pausedBy: "buyer" };
      break;
    case "resume":
      if (sub.status === "active") throw new UserError("It's already active.");
      set = { status: "active", pausedBy: null, failures: 0, lastError: null, nextOrderAt: sub.nextOrderAt < soonest ? soonest : sub.nextOrderAt };
      break;
    case "cancel":
      set = { status: "cancelled", pausedBy: null, cancelledAt: now };
      break;
  }
  await db.update(schema.subscriptions).set({ ...set, updatedAt: now }).where(eq(schema.subscriptions.id, sub.id));
  return getSubscriptionByToken(db, shop, token);
}

/** All of a store's subscriptions, newest first, with the deliveries and sales each has brought. */
export async function listSubscriptions(db: Db, shopId: string) {
  const subs = await db.query.subscriptions.findMany({ where: eq(schema.subscriptions.shopId, shopId), orderBy: desc(schema.subscriptions.createdAt) });
  const totals = subs.length
    ? await db
        .select({ id: schema.orders.subscriptionId, orders: sql<number>`count(*)`.mapWith(Number), salesMinor: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)`.mapWith(Number) })
        .from(schema.orders)
        .where(and(inArray(schema.orders.subscriptionId, subs.map((s) => s.id)), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"])))
        .groupBy(schema.orders.subscriptionId)
    : [];
  const firsts = subs.length
    ? await db.select({ id: schema.orders.id, number: schema.orders.number }).from(schema.orders).where(inArray(schema.orders.id, subs.map((s) => s.firstOrderId)))
    : [];
  return subs.map((s) => {
    const t = totals.find((x) => x.id === s.id);
    return { ...s, firstOrderNumber: firsts.find((o) => o.id === s.firstOrderId)?.number ?? null, deliveries: t?.orders ?? 0, salesMinor: t?.salesMinor ?? 0 };
  });
}

/** Active subscriptions and what repeat deliveries have brought in, for the Marketing page. */
export async function subscriptionStats(db: Db, shopId: string) {
  const [active] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.shopId, shopId), eq(schema.subscriptions.status, "active")));
  const [sales] = await db
    .select({ orders: sql<number>`count(*)`.mapWith(Number), salesMinor: sql<number>`coalesce(sum(${schema.orders.totalMinor} - ${schema.orders.refundedMinor}), 0)`.mapWith(Number) })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), eq(schema.orders.source, "subscription"), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"])));
  return { active: active?.n ?? 0, orders: sales?.orders ?? 0, salesMinor: sales?.salesMinor ?? 0 };
}

/** The merchant cancels a subscription (the buyer asked by message, say). The buyer gets an email. */
export async function cancelSubscriptionForBuyer(ctx: Pick<SubscriptionContext, "db" | "mailer">, shop: Shop, subscriptionId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const [sub] = await ctx.db
    .update(schema.subscriptions)
    .set({ status: "cancelled", pausedBy: null, cancelledAt: now, updatedAt: now })
    .where(and(eq(schema.subscriptions.id, subscriptionId), eq(schema.subscriptions.shopId, shop.id), ne(schema.subscriptions.status, "cancelled")))
    .returning();
  if (!sub) throw new UserError("This subscription is already cancelled.");
  await ctx.mailer.send({
    to: sub.email,
    subject: `Your ${shop.name} subscription is cancelled`,
    text: [`Hi,`, ``, `${shop.name} cancelled your subscription. No more deliveries will be sent and your card won't be charged again.`, ``, `Reply to this email if that's a surprise.`].join("\n"),
  });
  return sub;
}

/**
 * Places and charges the next delivery. A charge that fails (declined card, sold out) is tried
 * again in two days; after three failures in a row the subscription pauses and the buyer is told.
 */
export async function renewSubscription(ctx: SubscriptionContext, subscriptionId: string, opts: { now?: Date } = {}) {
  const { db } = ctx;
  const now = opts.now ?? ctx.now?.() ?? new Date();
  const sub = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, subscriptionId) });
  if (!sub || sub.status !== "active") return { status: "skipped" as const };
  // Claim it by moving the date on, so two runs at once can't both charge.
  const [claimed] = await db
    .update(schema.subscriptions)
    .set({ nextOrderAt: new Date(now.getTime() + sub.intervalDays * DAY), updatedAt: now })
    .where(and(eq(schema.subscriptions.id, sub.id), eq(schema.subscriptions.status, "active"), eq(schema.subscriptions.nextOrderAt, sub.nextOrderAt)))
    .returning({ id: schema.subscriptions.id });
  if (!claimed) return { status: "skipped" as const };
  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, sub.shopId) }))!;
  const first = await db.query.orders.findFirst({ where: eq(schema.orders.id, sub.firstOrderId), columns: { paymentIntentId: true } });

  let order: Order | null = null;
  try {
    ({ order } = await startCheckout(
      db,
      ctx.payments,
      shop,
      { email: sub.email, address: sub.shippingAddress, lines: sub.lines, subscription: { id: sub.id, percentOff: sub.percentOff } },
      ctx.taxCalculator,
    ));
    const charged = await ctx.payments.chargeSavedCard({
      fromPaymentIntentId: first!.paymentIntentId!,
      amountMinor: order.totalMinor,
      currency: order.currency,
      shopAccountId: shop.paymentsAccountId,
      applicationFeeMinor: order.platformFeeMinor,
      metadata: { shopId: shop.id, subscriptionId: sub.id },
    });
    await db.update(schema.orders).set({ paymentIntentId: charged.id }).where(eq(schema.orders.id, order.id));
    await handlePaymentEvent(db, ctx.payments.name, { id: `charged_${charged.id}`, type: "payment.succeeded", paymentIntentId: charged.id, amountMinor: order.totalMinor });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    if (order) await db.delete(schema.orders).where(eq(schema.orders.id, order.id));
    return failRenewal(ctx, shop, sub, e.message, now);
  }
  await db.update(schema.subscriptions).set({ failures: 0, lastError: null }).where(eq(schema.subscriptions.id, sub.id));
  await onOrderPaid(ctx, order.id);
  return { status: "ordered" as const, order: (await db.query.orders.findFirst({ where: eq(schema.orders.id, order.id) }))! };
}

async function failRenewal(ctx: SubscriptionContext, shop: Shop, sub: Subscription, error: string, now: Date) {
  const failures = sub.failures + 1;
  if (failures < MAX_FAILURES) {
    await ctx.db
      .update(schema.subscriptions)
      .set({ failures, lastError: error, nextOrderAt: new Date(now.getTime() + RETRY_DAYS * DAY) })
      .where(eq(schema.subscriptions.id, sub.id));
    return { status: "failed" as const, error, paused: false };
  }
  await ctx.db
    .update(schema.subscriptions)
    .set({ failures, lastError: error, status: "paused", pausedBy: "payment" })
    .where(eq(schema.subscriptions.id, sub.id));
  await ctx.mailer.send({
    to: sub.email,
    subject: `Your ${shop.name} subscription is paused`,
    text: [
      `Hi,`,
      ``,
      `We tried ${MAX_FAILURES} times to send your next delivery but couldn't: ${error}`,
      ``,
      `Nothing was charged. Your subscription is paused until you resume it, or you can cancel it:`,
      await ctx.manageUrl(shop, sub.token),
    ].join("\n"),
  });
  return { status: "failed" as const, error, paused: true };
}

/** "Coming up" emails for deliveries in the next three days, once per delivery date. */
export async function sendSubscriptionReminders(ctx: Pick<SubscriptionContext, "db" | "mailer" | "manageUrl" | "now">, opts: { limit?: number; now?: Date } = {}) {
  const { db } = ctx;
  const now = opts.now ?? ctx.now?.() ?? new Date();
  const soon = await db.query.subscriptions.findMany({
    where: and(
      eq(schema.subscriptions.status, "active"),
      gt(schema.subscriptions.nextOrderAt, now),
      lte(schema.subscriptions.nextOrderAt, new Date(now.getTime() + REMIND_DAYS * DAY)),
      or(isNull(schema.subscriptions.remindedFor), ne(schema.subscriptions.remindedFor, schema.subscriptions.nextOrderAt)),
    ),
    limit: opts.limit ?? 500,
  });
  let sent = 0;
  for (const sub of soon) {
    const [claimed] = await db
      .update(schema.subscriptions)
      .set({ remindedFor: sub.nextOrderAt })
      .where(and(eq(schema.subscriptions.id, sub.id), eq(schema.subscriptions.nextOrderAt, sub.nextOrderAt)))
      .returning({ id: schema.subscriptions.id });
    if (!claimed) continue;
    const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, sub.shopId) }))!;
    const price = await priceDelivery(db, shop, sub.lines, sub.shippingAddress.country, sub.percentOff).catch((e) => {
      if (e instanceof UserError) return null;
      throw e;
    });
    try {
      await ctx.mailer.send({
        to: sub.email,
        subject: `Your next ${shop.name} delivery is on ${formatDeliveryDate(sub.nextOrderAt)}`,
        text: [
          `Hi ${sub.shippingAddress.name.split(" ")[0]},`,
          ``,
          price
            ? `On ${formatDeliveryDate(sub.nextOrderAt)} we'll charge your card ${formatMoney(price.eachMinor, shop.currency)}, plus any tax, and send:`
            : `On ${formatDeliveryDate(sub.nextOrderAt)} we'll charge your card and send:`,
          itemList(price?.items ?? sub.lines.map((l) => ({ title: "Item", quantity: l.quantity }))),
          ``,
          `It goes to ${sub.shippingAddress.name}, ${sub.shippingAddress.line1}, ${sub.shippingAddress.city}.`,
          ``,
          `Want to skip this one, change how often, or cancel? You can until then:`,
          await ctx.manageUrl(shop, sub.token),
        ].join("\n"),
      });
      sent++;
    } catch {
      await db.update(schema.subscriptions).set({ remindedFor: sub.remindedFor }).where(eq(schema.subscriptions.id, sub.id));
    }
  }
  return { sent };
}

/** The scheduled job: reminders first, then every delivery that's due. */
export async function runDueSubscriptions(ctx: SubscriptionContext, opts: { limit?: number } = {}) {
  const now = ctx.now?.() ?? new Date();
  const reminders = await sendSubscriptionReminders(ctx, { now });
  const due = await ctx.db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.status, "active"), lte(schema.subscriptions.nextOrderAt, now)))
    .orderBy(schema.subscriptions.nextOrderAt)
    .limit(opts.limit ?? 200);
  let ordered = 0;
  let failed = 0;
  for (const d of due) {
    const r = await renewSubscription(ctx, d.id, { now });
    if (r.status === "ordered") ordered++;
    if (r.status === "failed") failed++;
  }
  return { reminded: reminders.sent, ordered, failed };
}

function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}
