"use server";
import { NotFoundError, supplierCantSend, supplierMarkShipped, UserError } from "@sf/core";
import { fulfillment } from "@/lib/server";

export type PortalState = { error?: string; done?: string };

async function attempt(fn: () => Promise<unknown>, done: string): Promise<PortalState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    if (e instanceof NotFoundError) return { error: "This link or order no longer works. Ask the store for a new link." };
    throw e;
  }
  // No revalidation: the order keeps its card with the confirmation until the page is reloaded.
  return { done };
}

export async function markShippedAction(token: string, fulfillmentId: string, _: PortalState, form: FormData): Promise<PortalState> {
  const input = { carrier: String(form.get("carrier") ?? ""), trackingNumber: String(form.get("trackingNumber") ?? ""), url: String(form.get("url") ?? "") };
  return attempt(async () => supplierMarkShipped(await fulfillment(), token, fulfillmentId, input), "Marked as shipped. The buyer has their tracking.");
}

export async function cantSendAction(token: string, fulfillmentId: string, _: PortalState, form: FormData): Promise<PortalState> {
  const input = { reason: String(form.get("reason") ?? "") as "out_of_stock", note: String(form.get("note") ?? "") || undefined };
  return attempt(async () => supplierCantSend(await fulfillment(), token, fulfillmentId, input), "Thanks. The store has been told.");
}
