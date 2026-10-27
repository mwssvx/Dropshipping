"use server";
import { formatMoney, giftCardBalance } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeT } from "../data";

export type BalanceState = { error?: string; result?: { last4: string; message: string; ok: boolean } };

/** Looks up what's left on a gift card from its code. */
export async function checkBalanceAction(handle: string, _: BalanceState, form: FormData): Promise<BalanceState> {
  const shop = await loadShop(handle);
  const t = await storeT(handle);
  const card = await giftCardBalance(await db(), shop.id, String(form.get("code") ?? ""));
  if (!card) return { error: t.giftCardNotFound };
  const message =
    card.status === "off" ? t.giftCardOff : card.status === "used" ? t.giftCardUsedUp : t.giftCardLeftOf(formatMoney(card.balanceMinor, card.currency), formatMoney(card.initialMinor, card.currency));
  return { result: { last4: card.last4, message, ok: card.status === "ok" } };
}
