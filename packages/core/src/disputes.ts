// Disputes: a buyer asked their bank for the money back (a chargeback), or the bank asked a
// question first (an inquiry). We record each one against its order, tell the merchant, and put
// the evidence together for them: tracking, delivery, the returns policy and messages with the
// buyer. The merchant checks it, adds a note if they like, and sends it, or accepts the dispute.
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import type { Mailer } from "./email";
import { formatMoney } from "./money";
import type { DisputeEvidence, PaymentProvider, ProviderDispute } from "./payments";
import { can } from "./team";

type Shop = typeof schema.shops.$inferSelect;
type Dispute = typeof schema.disputes.$inferSelect;

const DAY = 86_400_000;

/** What each card-network reason means, and what answers it best. */
export const DISPUTE_REASONS: Record<string, { label: string; tip: string }> = {
  fraudulent: {
    label: "The cardholder says they didn't make this payment",
    tip: "Tracking to the buyer's address, and messages from them, show the real cardholder ordered it and got it.",
  },
  product_not_received: { label: "The buyer says it never arrived", tip: "Tracking that shows it was delivered is the strongest answer." },
  product_unacceptable: {
    label: "The buyer says it was damaged or not as described",
    tip: "Your product description, your returns policy, and any refund or replacement you offered help most.",
  },
  duplicate: { label: "The buyer says they were charged twice", tip: "Show the other charge was for a different order, or was refunded." },
  credit_not_processed: { label: "The buyer says they were promised a refund", tip: "Show the refund, or why the return didn't qualify under your policy." },
  subscription_canceled: { label: "The buyer says they cancelled a subscription", tip: "Show the charge came before they cancelled." },
  unrecognized: { label: "The cardholder doesn't recognize the charge", tip: "Your store name and the order details usually settle it." },
  general: { label: "The bank didn't give a specific reason", tip: "Send everything: tracking, your policies and messages." },
};
export const disputeReason = (reason: string) => DISPUTE_REASONS[reason] ?? DISPUTE_REASONS.general!;

/** The processor's fee for a lost dispute (Stripe's in the US), counted against profit. */
export const DISPUTE_FEE_MINOR = 1500;

/** Stripe treats a dispute rate at or above this share of orders as too high. */
export const DISPUTE_RATE_LIMIT = 0.0075;

/** Records a dispute event against its order. Null when the payment isn't one of our orders. */
export async function applyDisputeEvent(db: Db, d: ProviderDispute) {
  const order = await db.query.orders.findFirst({ where: eq(schema.orders.paymentIntentId, d.paymentIntentId), columns: { id: true, shopId: true } });
  if (!order) return null;
  const values = { amountMinor: d.amountMinor, currency: d.currency, reason: d.reason, status: d.status, inquiry: d.inquiry, evidenceDueBy: d.evidenceDueBy, updatedAt: new Date() };
  const [row] = await db
    .insert(schema.disputes)
    .values({ shopId: order.shopId, orderId: order.id, providerDisputeId: d.id, ...values })
    .onConflictDoUpdate({ target: schema.disputes.providerDisputeId, set: values })
    .returning();
  return row!;
}

async function loadDispute(db: Db, shopId: string, disputeId: string) {
  const dispute = await db.query.disputes.findFirst({ where: and(eq(schema.disputes.id, disputeId), eq(schema.disputes.shopId, shopId)) });
  if (!dispute) throw new NotFoundError("Dispute");
  return dispute;
}

const day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type EvidenceCheck = { label: string; ok: boolean; detail: string };

/**
 * The evidence for a dispute, put together from the order: who bought what, where it went, its
 * tracking and delivery, the store's returns policy, earlier orders and messages with the buyer.
 * `checks` says what's there and what's missing, for the merchant.
 */
export async function disputeEvidence(db: Db, shop: Shop, disputeId: string, opts: { note?: string | null } = {}) {
  const dispute = await loadDispute(db, shop.id, disputeId);
  if (!dispute.orderId) throw new UserError("This dispute isn't linked to an order any more, so we can't gather evidence for it.");
  const order = (await db.query.orders.findFirst({ where: eq(schema.orders.id, dispute.orderId) }))!;
  const lines = await db.query.orderLines.findMany({ where: eq(schema.orderLines.orderId, order.id) });
  const shipments = await db.query.fulfillments.findMany({ where: eq(schema.fulfillments.orderId, order.id), orderBy: asc(schema.fulfillments.createdAt) });
  const tracked = shipments.filter((f) => f.trackingNumber);
  const delivered = shipments.filter((f) => f.status === "delivered");
  const [policy] = await db
    .select({ title: schema.pages.title, body: schema.pages.body })
    .from(schema.pages)
    .where(and(eq(schema.pages.shopId, shop.id), or(ilike(schema.pages.title, "%return%"), ilike(schema.pages.title, "%refund%"))))
    .limit(1);
  const conversation = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.orderId, order.id), eq(schema.conversations.kind, "buyer")) });
  const messages = conversation
    ? (await db.query.messages.findMany({ where: eq(schema.messages.conversationId, conversation.id), orderBy: asc(schema.messages.createdAt) })).filter(
        (m) => m.status === "sent" && m.author !== "staff",
      )
    : [];
  const [earlier] = await db
    .select({ n: count() })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shop.id), eq(schema.orders.email, order.email), ne(schema.orders.id, order.id), inArray(schema.orders.paymentStatus, ["paid", "partially_refunded"]), lt(schema.orders.createdAt, order.createdAt)));
  const a = order.shippingAddress;
  const address = [a.name, a.line1, a.line2, `${a.city}${a.region ? `, ${a.region}` : ""} ${a.postalCode}`, a.country].filter(Boolean).join(", ");
  const items = lines.map((l) => `${l.quantity} × ${l.title}`).join("; ");
  const money = (m: number) => formatMoney(m, order.currency);
  const note = opts.note?.trim() || dispute.note;

  const text = [
    `Order #${order.number} from ${shop.name}, placed ${day.format(order.paidAt ?? order.createdAt)} for ${money(order.totalMinor)} by ${a.name} (${order.email}).`,
    `Items: ${items}.`,
    `Shipped to: ${address}.`,
    ...tracked.map(
      (f) =>
        `Shipment: ${f.carrier ?? "carrier"} tracking ${f.trackingNumber}${f.shippedAt ? `, shipped ${day.format(f.shippedAt)}` : ""}${f.status === "delivered" ? `, delivered${f.deliveredAt ? ` ${day.format(f.deliveredAt)}` : ""}` : ""}.`,
    ),
    ...(earlier && earlier.n > 0 ? [`The same buyer has ${earlier.n} earlier paid ${earlier.n === 1 ? "order" : "orders"} with this store.`] : []),
    ...(order.refundedMinor > 0 ? [`${money(order.refundedMinor)} of this order has already been refunded.`] : []),
    ...(messages.length
      ? ["", "Messages with the buyer:", ...messages.slice(-10).map((m) => `${day.format(m.createdAt)}, ${m.author === "buyer" ? "buyer" : shop.name}: ${clip(m.body.replace(/\s+/g, " "), 400)}`)]
      : []),
    ...(note ? ["", `From the merchant: ${note}`] : []),
  ].join("\n");

  const evidence: DisputeEvidence = {
    customerName: a.name,
    customerEmail: order.email,
    shippingAddress: address,
    productDescription: clip(items, 1000),
    shippingCarrier: tracked[0]?.carrier ?? null,
    shippingTrackingNumber: tracked.map((f) => f.trackingNumber).join(", ") || null,
    shippingDate: tracked[0]?.shippedAt ? isoDay(tracked[0].shippedAt) : null,
    refundPolicy: policy ? clip(`${policy.title}: ${policy.body}`, 2000) : null,
    uncategorizedText: clip(text, 20_000),
  };
  const checks: EvidenceCheck[] = [
    { label: "Tracking number", ok: tracked.length > 0, detail: tracked.length ? tracked.map((f) => f.trackingNumber).join(", ") : "No tracking yet. Add it on the order if the supplier sent one." },
    { label: "Delivered", ok: delivered.length > 0, detail: delivered.length ? "The carrier shows it delivered." : "The carrier hasn't shown it delivered." },
    { label: "Returns policy", ok: !!policy, detail: policy ? `Your "${policy.title}" page.` : "Add a returns or refund page so buyers, and banks, can see your policy." },
    { label: "Messages with the buyer", ok: messages.length > 0, detail: messages.length ? `${messages.length} ${messages.length === 1 ? "message" : "messages"}.` : "None. That's fine if they never wrote." },
  ];
  return { dispute, order: { id: order.id, number: order.number }, evidence, checks };
}

/** Sends the evidence (with the merchant's note) and marks the dispute as being reviewed. */
export async function submitDispute(ctx: { db: Db; payments: PaymentProvider }, shop: Shop, disputeId: string, input: { note?: string | null }, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const note = input.note?.trim() || null;
  if (note && note.length > 2000) throw new UserError("Keep your note under 2,000 characters.");
  const dispute = await loadDispute(ctx.db, shop.id, disputeId);
  if (dispute.status !== "needs_response") throw new UserError("This dispute isn't waiting for an answer.");
  if (dispute.evidenceDueBy && dispute.evidenceDueBy < now) throw new UserError("The deadline to answer this dispute has passed.");
  const { evidence } = await disputeEvidence(ctx.db, shop, disputeId, { note });
  await ctx.payments.submitDisputeEvidence({ disputeId: dispute.providerDisputeId, evidence });
  const [row] = await ctx.db
    .update(schema.disputes)
    .set({ status: "under_review", note, submittedAt: now, updatedAt: now })
    .where(eq(schema.disputes.id, dispute.id))
    .returning();
  return row!;
}

/** The merchant agrees the buyer should have the money back. */
export async function acceptDispute(ctx: { db: Db; payments: PaymentProvider }, shop: Shop, disputeId: string, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const dispute = await loadDispute(ctx.db, shop.id, disputeId);
  if (dispute.status !== "needs_response") throw new UserError("This dispute isn't waiting for an answer.");
  await ctx.payments.acceptDispute(dispute.providerDisputeId);
  const [row] = await ctx.db
    .update(schema.disputes)
    .set({ status: dispute.inquiry ? "closed" : "lost", updatedAt: now })
    .where(eq(schema.disputes.id, dispute.id))
    .returning();
  return row!;
}

/** A store's disputes, open ones first, then newest. */
export async function listDisputes(db: Db, shopId: string) {
  const rows = await db
    .select({ dispute: schema.disputes, number: schema.orders.number, email: schema.orders.email })
    .from(schema.disputes)
    .leftJoin(schema.orders, eq(schema.orders.id, schema.disputes.orderId))
    .where(eq(schema.disputes.shopId, shopId))
    .orderBy(sql`case when ${schema.disputes.status} = 'needs_response' then 0 else 1 end`, desc(schema.disputes.createdAt));
  return rows.map((r) => ({ ...r.dispute, orderNumber: r.number, email: r.email }));
}

export async function disputesForOrder(db: Db, orderId: string) {
  return db.query.disputes.findMany({ where: eq(schema.disputes.orderId, orderId), orderBy: desc(schema.disputes.createdAt) });
}

/** Open disputes, money at stake, and the dispute rate over the last 90 days. */
export async function disputeStats(db: Db, shopId: string, now = new Date()) {
  const all = await db.query.disputes.findMany({ where: eq(schema.disputes.shopId, shopId) });
  const since = new Date(now.getTime() - 90 * DAY);
  const [paid] = await db
    .select({ n: count() })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), isNull(schema.orders.subscriptionId), gte(schema.orders.paidAt, since)));
  const recent = all.filter((d) => !d.inquiry && d.createdAt >= since).length;
  const orders = paid?.n ?? 0;
  return {
    open: all.filter((d) => d.status === "needs_response").length,
    atStakeMinor: all.filter((d) => d.status === "needs_response" || d.status === "under_review").reduce((s, d) => s + d.amountMinor, 0),
    won: all.filter((d) => d.status === "won").length,
    lost: all.filter((d) => d.status === "lost").length,
    recent,
    orders,
    rate: orders ? recent / orders : 0,
  };
}

/**
 * Emails everyone who looks after the store's money about each new dispute, once. Runs after the
 * webhook, and on the schedule for any that were missed.
 */
export async function notifyNewDisputes(ctx: { db: Db; mailer: Mailer; adminUrl: (path: string) => string }, opts: { shopId?: string } = {}) {
  const { db } = ctx;
  const fresh = await db.query.disputes.findMany({
    where: and(isNull(schema.disputes.notifiedAt), eq(schema.disputes.status, "needs_response"), opts.shopId ? eq(schema.disputes.shopId, opts.shopId) : undefined),
    limit: 200,
  });
  let sent = 0;
  for (const d of fresh) {
    const [claimed] = await db
      .update(schema.disputes)
      .set({ notifiedAt: new Date() })
      .where(and(eq(schema.disputes.id, d.id), isNull(schema.disputes.notifiedAt)))
      .returning({ id: schema.disputes.id });
    if (!claimed) continue;
    const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, d.shopId) }))!;
    const order = d.orderId ? await db.query.orders.findFirst({ where: eq(schema.orders.id, d.orderId), columns: { number: true } }) : null;
    const people = await db
      .select({ email: schema.users.email, role: schema.shopMembers.role })
      .from(schema.shopMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.shopMembers.userId))
      .where(eq(schema.shopMembers.shopId, d.shopId));
    const reason = disputeReason(d.reason);
    const what = order ? `Order #${order.number}` : "A payment";
    for (const p of people.filter((x) => can(x.role, "money"))) {
      await ctx.mailer.send({
        to: p.email,
        subject: d.inquiry ? `${what} has a question from the buyer's bank` : `${what} was disputed${d.evidenceDueBy ? `: answer by ${day.format(d.evidenceDueBy)}` : ""}`,
        text: [
          `Hi,`,
          ``,
          d.inquiry
            ? `The buyer's bank is asking about ${formatMoney(d.amountMinor, d.currency)} paid to ${shop.name}. Nothing has been taken back yet, but it can be if there's no answer.`
            : `The buyer asked their bank to take back ${formatMoney(d.amountMinor, d.currency)} paid to ${shop.name}. The money is held until the bank decides.`,
          ``,
          `Reason: ${reason.label}.`,
          `What helps: ${reason.tip}`,
          ``,
          `We've put the evidence together from the order. Check it, add anything you know, and send it${d.evidenceDueBy ? ` before ${day.format(d.evidenceDueBy)}` : ""}:`,
          ctx.adminUrl(d.orderId ? `/admin/orders/${d.orderId}#dispute` : "/admin/disputes"),
        ].join("\n"),
      });
      sent++;
    }
  }
  return { sent };
}

export type { Dispute };

/** Disputes waiting for the merchant's answer, for the admin menu. */
export async function countOpenDisputes(db: Db, shopId: string) {
  const [row] = await db.select({ n: count() }).from(schema.disputes).where(and(eq(schema.disputes.shopId, shopId), eq(schema.disputes.status, "needs_response")));
  return row?.n ?? 0;
}
