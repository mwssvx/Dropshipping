"use server";
import { redirect } from "next/navigation";
import { applyForWholesale, reorderLines, requestBuyerCode, signOutBuyer, subscribeBuyer, unsubscribeBuyer, UserError, verifyBuyerCode } from "@sf/core";
import { readCart, writeCart } from "@/lib/cart";
import { buyerToken, clearBuyerCookie, currentBuyer, setBuyerCookie } from "@/lib/buyer";
import { db, mailer } from "@/lib/server";
import { loadShop, storeBase } from "../data";

export type SignInState = { step?: "email" | "code"; email?: string; error?: string };

/** Step one sends a code to the email; step two checks it and signs the buyer in. */
export async function buyerSignInAction(handle: string, _: SignInState, form: FormData): Promise<SignInState> {
  const shop = await loadShop(handle);
  const email = String(form.get("email") ?? "");
  const code = form.get("code");
  try {
    if (code === null || form.get("resend") === "1") {
      const sent = await requestBuyerCode({ db: await db(), mailer: mailer() }, shop, email);
      return { step: "code", email: sent.email };
    }
    const { token } = await verifyBuyerCode(await db(), shop.id, email, String(code));
    await setBuyerCookie(shop.id, token);
  } catch (e) {
    if (e instanceof UserError) return { step: code === null ? "email" : "code", email, error: e.message };
    throw e;
  }
  redirect(`${await storeBase(handle)}/account`);
}

export async function buyerSignOutAction(handle: string) {
  const shop = await loadShop(handle);
  const token = await buyerToken(shop.id);
  if (token) await signOutBuyer(await db(), token);
  await clearBuyerCookie(shop.id);
  redirect(`${await storeBase(handle)}/account`);
}

/** Puts what's still for sale from a past order into the cart. */
export async function buyAgainAction(handle: string, orderId: string) {
  const shop = await loadShop(handle);
  const base = await storeBase(handle);
  const buyer = await currentBuyer(shop.id);
  if (!buyer) redirect(`${base}/account`);
  const { lines, missing } = await reorderLines(await db(), shop.id, buyer.email, orderId);
  const cart = await readCart(shop.id);
  for (const l of lines) {
    const existing = cart.find((c) => c.variantId === l.variantId);
    if (existing) existing.quantity = Math.min(99, existing.quantity + l.quantity);
    else cart.push(l);
  }
  await writeCart(shop.id, cart);
  redirect(`${base}/cart${missing ? `?unavailable=${missing}` : ""}`);
}

/** The "Send me news and offers" switch on the account page. */
export async function setBuyerMarketingAction(handle: string, subscribe: boolean) {
  const shop = await loadShop(handle);
  const buyer = await currentBuyer(shop.id);
  if (!buyer) redirect(`${await storeBase(handle)}/account`);
  if (subscribe) await subscribeBuyer(await db(), shop.id, buyer.email);
  else await unsubscribeBuyer(await db(), shop.id, buyer.email);
  redirect(`${await storeBase(handle)}/account`);
}

/** A signed-in buyer asks the store for wholesale prices. */
export async function applyWholesaleAction(handle: string, _: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const shop = await loadShop(handle);
  const buyer = await currentBuyer(shop.id);
  if (!buyer) redirect(`${await storeBase(handle)}/account`);
  try {
    await applyForWholesale(await db(), shop, buyer.email, {
      company: String(form.get("company") ?? ""),
      taxId: String(form.get("taxId") ?? ""),
      message: String(form.get("message") ?? ""),
    });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`${await storeBase(handle)}/account`);
}
