// Gift card bonus: "Buy $50 in gift cards, get a $10 bonus card", the classic holiday offer. While
// the offer's dates last, an order with gift cards on it also gets the buyer a bonus card for every
// step it reaches, emailed to them once they've paid (not to whoever the gift cards are for). The
// bonus card can be held back until a later date ("use it from January 1"), and unlike a bought
// gift card it can expire, since nobody paid for it. Refunding the order turns it off with the rest.
import { eq } from "drizzle-orm";
import { schema, type Db, type GiftCardBonus } from "@sf/db";
import { UserError } from "./errors";

type Shop = typeof schema.shops.$inferSelect;

const DAY = 86_400_000;
/** The biggest bonus one order can get, as for any gift card. */
const MAX_BONUS_MINOR = 1_000_000;

function parseDay(value: string | null | undefined) {
  const v = (value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === v ? t : null;
}

/** Sets the bonus offer, or ends it with null. */
export async function setGiftCardBonus(db: Db, shopId: string, input: GiftCardBonus | null, now = new Date()) {
  let value: GiftCardBonus | null = null;
  if (input) {
    const { everyMinor, bonusMinor } = input;
    if (!Number.isInteger(everyMinor) || everyMinor < 100 || everyMinor > MAX_BONUS_MINOR) throw new UserError("Enter how much in gift cards earns a bonus.");
    if (!Number.isInteger(bonusMinor) || bonusMinor < 100) throw new UserError("Enter the bonus card's amount.");
    if (bonusMinor > everyMinor) throw new UserError("Keep the bonus at most what the buyer spends on gift cards.");
    const [from, to] = [parseDay(input.from), parseDay(input.to)];
    if (from === null || to === null) throw new UserError("Pick the first and last day of the offer.");
    if (to < from) throw new UserError("The offer's last day can't be before its first.");
    if (to < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) throw new UserError("Pick a last day that hasn't passed.");
    if (to > from + 365 * DAY) throw new UserError("Keep the offer within a year.");
    const usableFrom = input.usableFrom?.trim() ? parseDay(input.usableFrom) : null;
    const usableUntil = input.usableUntil?.trim() ? parseDay(input.usableUntil) : null;
    if (input.usableFrom?.trim() && usableFrom === null) throw new UserError("Pick the day bonus cards can be used from, or leave it empty.");
    if (input.usableUntil?.trim() && usableUntil === null) throw new UserError("Pick the day bonus cards expire, or leave it empty.");
    if (usableUntil !== null && usableUntil < Math.max(to, usableFrom ?? 0)) throw new UserError("Bonus cards have to stay usable after the offer's last day.");
    value = {
      everyMinor,
      bonusMinor,
      from: input.from.trim(),
      to: input.to.trim(),
      usableFrom: usableFrom === null ? null : input.usableFrom!.trim(),
      usableUntil: usableUntil === null ? null : input.usableUntil!.trim(),
    };
  }
  await db.update(schema.shops).set({ giftCardBonus: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/** The offer while it's on (for the gift card's product page), else null. */
export function giftCardBonusNow(shop: Pick<Shop, "giftCardBonus">, now = new Date()) {
  const b = shop.giftCardBonus;
  if (!b) return null;
  const [from, to] = [parseDay(b.from), parseDay(b.to)];
  if (from === null || to === null) return null;
  const t = now.getTime();
  return t >= from && t < to + DAY ? b : null;
}

/** What a bonus card made at `at` is worth for this much in gift cards, and the dates it can be spent between (or null each). */
export function giftCardBonusFor(shop: Pick<Shop, "giftCardBonus">, giftCardsMinor: number, at: Date) {
  const b = giftCardBonusNow(shop, at);
  if (!b || giftCardsMinor < b.everyMinor) return null;
  const amountMinor = Math.min(Math.floor(giftCardsMinor / b.everyMinor) * b.bonusMinor, MAX_BONUS_MINOR);
  const from = parseDay(b.usableFrom);
  const until = parseDay(b.usableUntil);
  return {
    amountMinor,
    // Spendable from the start of its first day to the end of its last, by the calendar.
    usableFrom: from !== null && from > at.getTime() ? new Date(from) : null,
    expiresAt: until !== null ? new Date(until + DAY) : null,
  };
}
