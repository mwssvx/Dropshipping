import "server-only";
import { after } from "next/server";
import { handlePaymentEvent, notifyNewDisputes, onOrderPaid, sendShopNotifications, sendShopWebhooks } from "@sf/core";
import { db, adminNotices, fulfillment, payments, pushSender, tax, webhooks } from "./server";

/**
 * Verify, then apply, a payment webhook. Used by the webhook route and the test-mode pay button.
 * When an order first becomes paid, the confirmation email and supplier order run after the
 * response is sent; the scheduled job picks up anything that didn't finish.
 */
export async function processPaymentWebhook(rawBody: string, signature: string | null) {
  const provider = payments();
  const event = await provider.parseWebhook(rawBody, signature);
  if (!event) return { status: "ignored" as const };
  const result = await handlePaymentEvent(await db(), provider.name, event);
  if (result.status === "processed" && result.becamePaid) afterOrderPaid(result.orderId);
  if (result.status === "processed" && "disputeShopId" in result && result.disputeShopId) afterDispute(result.disputeShopId);
  return result;
}

/** A new or changed dispute: email the store's money people and push to their phones. */
function afterDispute(shopId: string) {
  after(async () => {
    try {
      await notifyNewDisputes(await adminNotices(), { shopId });
      await sendShopNotifications({ db: await db(), push: pushSender() }, shopId);
    } catch (e) {
      console.error(`Dispute notices for shop ${shopId} failed; the scheduled job will retry.`, e);
    }
  });
}

/** Confirmation email, gift cards, supplier orders, tax, push and webhooks, after the response is sent. */
export function afterOrderPaid(orderId: string) {
  after(async () => {
    try {
      await onOrderPaid(await fulfillment(), orderId);
    } catch (e) {
      console.error(`Routing order ${orderId} failed; the scheduled job will retry.`, e);
    }
    try {
      const order = await (await db()).query.orders.findFirst({ where: (o, { eq }) => eq(o.id, orderId) });
      if (order?.taxCalculationId) await tax().record(order.taxCalculationId, order.id);
    } catch (e) {
      console.error(`Recording tax for order ${orderId} failed.`, e);
    }
    try {
      const order = await (await db()).query.orders.findFirst({ where: (o, { eq }) => eq(o.id, orderId) });
      if (order) await sendShopNotifications({ db: await db(), push: pushSender() }, order.shopId);
    } catch (e) {
      console.error(`Push notifications for order ${orderId} failed; the scheduled job will retry.`, e);
    }
    try {
      const order = await (await db()).query.orders.findFirst({ where: (o, { eq }) => eq(o.id, orderId) });
      if (order) await sendShopWebhooks(await webhooks(), order.shopId);
    } catch (e) {
      console.error(`Webhooks for order ${orderId} failed; the scheduled job will retry.`, e);
    }
  });
}
