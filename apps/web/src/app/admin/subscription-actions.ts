"use server";
import { revalidatePath } from "next/cache";
import { cancelSubscriptionForBuyer, renewSubscription, UserError } from "@sf/core";
import { requireShop, subscriptions, testPayments } from "@/lib/server";

export type SubscriptionActionState = { error?: string; done?: string };

/** The merchant cancels a buyer's subscription; the buyer gets an email. */
export async function cancelSubscriptionAction(id: string, _: SubscriptionActionState): Promise<SubscriptionActionState> {
  const { shop, db } = await requireShop("orders");
  try {
    await cancelSubscriptionForBuyer({ db, mailer: (await subscriptions()).mailer }, shop, id);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/subscriptions");
  return { done: "Cancelled. We've emailed the buyer." };
}

/** Test mode only: place and charge the next delivery now, as if its date had come. */
export async function sendNextDeliveryNowAction(id: string, _: SubscriptionActionState): Promise<SubscriptionActionState> {
  const { shop, db } = await requireShop("orders");
  if (!testPayments()) return { error: "Only in test mode." };
  const sub = await db.query.subscriptions.findFirst({ where: (s, { and, eq }) => and(eq(s.id, id), eq(s.shopId, shop.id)) });
  if (!sub) return { error: "That subscription isn't in your store." };
  const r = await renewSubscription(await subscriptions(), sub.id);
  revalidatePath("/admin/subscriptions");
  // The receipt, invoice and supplier order were handled while placing it.
  if (r.status === "ordered") return { done: `Placed order #${r.order.number}.` };
  if (r.status === "failed") return { error: `Couldn't place it: ${r.error}` };
  return { error: "It isn't active." };
}
