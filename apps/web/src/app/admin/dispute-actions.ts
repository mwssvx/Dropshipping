"use server";
import { revalidatePath } from "next/cache";
import { acceptDispute, FakePaymentProvider, submitDispute, UserError } from "@sf/core";
import { payments, requireShop, testPayments } from "@/lib/server";
import { processPaymentWebhook } from "@/lib/webhooks";

export type DisputeState = { error?: string; done?: string };

function refresh(orderId: string | null) {
  revalidatePath("/admin/disputes");
  if (orderId) revalidatePath(`/admin/orders/${orderId}`);
}

/** Sends the evidence we gathered, with the merchant's note. */
export async function submitDisputeAction(disputeId: string, _: DisputeState, form: FormData): Promise<DisputeState> {
  const { shop, db } = await requireShop("money");
  let orderId: string | null;
  try {
    ({ orderId } = await submitDispute({ db, payments: payments() }, shop, disputeId, { note: String(form.get("note") ?? "") }));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(orderId);
  return { done: "Evidence sent. The bank will decide, and we'll show the result here." };
}

export async function acceptDisputeAction(disputeId: string, _: DisputeState): Promise<DisputeState> {
  const { shop, db } = await requireShop("money");
  let orderId: string | null;
  try {
    ({ orderId } = await acceptDispute({ db, payments: payments() }, shop, disputeId));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(orderId);
  return { done: "Accepted. The buyer keeps the money back." };
}

/** Test mode only: a buyer's bank opens a dispute on this order, through the real webhook path. */
export async function simulateDisputeAction(orderId: string, _: DisputeState, form: FormData): Promise<DisputeState> {
  const { shop, db } = await requireShop("money");
  const provider = payments();
  if (!testPayments() || !(provider instanceof FakePaymentProvider)) return { error: "Only in test mode." };
  const order = await db.query.orders.findFirst({ where: (o, { and, eq }) => and(eq(o.id, orderId), eq(o.shopId, shop.id)) });
  if (!order?.paymentIntentId || !order.paidAt) return { error: "Only paid orders can be disputed." };
  const reason = String(form.get("reason") ?? "product_not_received");
  const { body, signature } = provider.disputeEvent({ paymentIntentId: order.paymentIntentId, amountMinor: order.totalMinor, currency: order.currency, reason });
  await processPaymentWebhook(body, signature);
  refresh(order.id);
  return {};
}

/** Test mode only: the bank decides a dispute that's being reviewed. */
export async function simulateDecisionAction(disputeId: string, outcome: "won" | "lost", _: DisputeState): Promise<DisputeState> {
  const { shop, db } = await requireShop("money");
  const provider = payments();
  if (!testPayments() || !(provider instanceof FakePaymentProvider)) return { error: "Only in test mode." };
  const d = await db.query.disputes.findFirst({ where: (x, { and, eq }) => and(eq(x.id, disputeId), eq(x.shopId, shop.id)) });
  const order = d?.orderId ? await db.query.orders.findFirst({ where: (o, { eq }) => eq(o.id, d.orderId!) }) : null;
  if (!d || !order?.paymentIntentId) return { error: "That dispute isn't in your store." };
  const { body, signature } = provider.disputeEvent({ id: d.providerDisputeId, paymentIntentId: order.paymentIntentId, amountMinor: d.amountMinor, currency: d.currency, reason: d.reason, inquiry: d.inquiry, evidenceDueBy: d.evidenceDueBy, status: outcome });
  await processPaymentWebhook(body, signature);
  refresh(order.id);
  return {};
}
