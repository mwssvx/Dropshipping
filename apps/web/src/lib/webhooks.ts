import "server-only";
import { after } from "next/server";
import { handlePaymentEvent, onOrderPaid } from "@sf/core";
import { db, fulfillment, payments, tax } from "./server";

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
  if (result.status === "processed" && result.becamePaid) {
    const orderId = result.orderId;
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
    });
  }
  return result;
}
