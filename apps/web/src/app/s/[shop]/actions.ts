"use server";
import { redirect } from "next/navigation";
import { getOrder, startCheckout, FakePaymentProvider, UserError } from "@sf/core";
import { readCart, writeCart } from "@/lib/cart";
import { db, payments } from "@/lib/server";
import { processPaymentWebhook } from "@/lib/webhooks";
import { loadShop } from "./data";

export async function addToCartAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  const variantId = String(form.get("variantId") ?? "");
  const quantity = Math.min(99, Math.max(1, Number(form.get("quantity") ?? 1) || 1));
  const cart = await readCart(shop.id);
  const line = cart.find((l) => l.variantId === variantId);
  if (line) line.quantity = Math.min(99, line.quantity + quantity);
  else cart.push({ variantId, quantity });
  await writeCart(shop.id, cart);
  redirect(`/s/${handle}/cart`);
}

export async function updateCartAction(handle: string, form: FormData) {
  const shop = await loadShop(handle);
  const variantId = String(form.get("variantId") ?? "");
  const quantity = Math.min(99, Math.max(0, Number(form.get("quantity") ?? 0) || 0));
  const cart = (await readCart(shop.id)).map((l) => (l.variantId === variantId ? { ...l, quantity } : l));
  await writeCart(shop.id, cart);
  redirect(`/s/${handle}/cart`);
}

export type CheckoutState = { error?: string; values?: Record<string, string> };

export async function checkoutAction(handle: string, _: CheckoutState, form: FormData): Promise<CheckoutState> {
  const shop = await loadShop(handle);
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  let orderId: string;
  try {
    const { order } = await startCheckout(await db(), payments(), shop, {
      email: values.email ?? "",
      address: {
        name: values.name ?? "",
        line1: values.line1 ?? "",
        line2: values.line2 || undefined,
        city: values.city ?? "",
        region: values.region || undefined,
        postalCode: values.postalCode ?? "",
        country: values.country ?? "",
      },
      lines: await readCart(shop.id),
    });
    orderId = order.id;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, values };
    throw e;
  }
  redirect(`/s/${handle}/pay/${orderId}`);
}

/**
 * Test mode only: stands in for the card form. It sends a signed "payment succeeded" webhook
 * through the same verification and idempotency path Stripe's webhook uses.
 */
export async function fakePayAction(handle: string, orderId: string) {
  const provider = payments();
  if (!(provider instanceof FakePaymentProvider)) throw new Error("Test payments are off.");
  const shop = await loadShop(handle);
  const order = await getOrder(await db(), shop.id, orderId);
  const { body, signature } = provider.succeededEvent(order.paymentIntentId!, order.totalMinor);
  await processPaymentWebhook(body, signature);
  await writeCart(shop.id, []);
  redirect(`/s/${handle}/orders/${order.paymentIntentId}`);
}
