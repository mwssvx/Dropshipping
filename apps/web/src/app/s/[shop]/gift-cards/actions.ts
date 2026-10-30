"use server";
import { formatMoney, giftCardBalance } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, storeLang, storeT } from "../data";

export type BalanceState = { error?: string; result?: { last4: string; message: string; ok: boolean } };

/** Looks up what's left on a gift card from its code. */
export async function checkBalanceAction(handle: string, _: BalanceState, form: FormData): Promise<BalanceState> {
  const shop = await loadShop(handle);
  const t = await storeT(handle);
  const card = await giftCardBalance(await db(), shop.id, String(form.get("code") ?? ""));
  if (!card) return { error: t.giftCardNotFound };
  const lang = (await storeLang(handle)) ?? "en-US";
  const day = (d: Date) => new Intl.DateTimeFormat(lang, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
  const now = new Date();
  // A bonus card's last day is the one before it stops working.
  const lastDay = card.expiresAt ? new Date(card.expiresAt.getTime() - 1) : null;
  const expired = card.status === "ok" && !!card.expiresAt && card.expiresAt <= now;
  const message =
    card.status === "off"
      ? t.giftCardOff
      : card.status === "used"
        ? t.giftCardUsedUp
        : expired
          ? t.giftCardExpired(day(lastDay!))
          : [
              t.giftCardLeftOf(formatMoney(card.balanceMinor, card.currency), formatMoney(card.initialMinor, card.currency)),
              card.usableFrom && card.usableFrom > now ? t.giftCardUsableFrom(day(card.usableFrom)) : null,
              lastDay ? t.giftCardExpires(day(lastDay)) : null,
            ]
              .filter(Boolean)
              .join(" ");
  return { result: { last4: card.last4, message, ok: card.status === "ok" && !expired } };
}
