import "server-only";
import { handlePaymentEvent } from "@sf/core";
import { db, payments } from "./server";

/** Verify, then apply, a payment webhook. Used by the webhook route and the test-mode pay button. */
export async function processPaymentWebhook(rawBody: string, signature: string | null) {
  const provider = payments();
  const event = await provider.parseWebhook(rawBody, signature);
  if (!event) return { status: "ignored" as const };
  return handlePaymentEvent(await db(), provider.name, event);
}
