// Checking a gift card's balance. Whoever has a code (often the person it was given to, not the
// buyer) can see what's left on it without starting a cart. Only the code itself unlocks it, and
// the answer never says who bought it or for whom.
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { schema, type Db } from "@sf/db";
import { normalizeGiftCardCode } from "./gift-cards";

/** What's left on a gift card, or null when the code doesn't match one of this store's. */
export async function giftCardBalance(db: Db, shopId: string, code: string) {
  const normalized = normalizeGiftCardCode(code);
  if (!normalized) return null;
  const card = await db.query.giftCards.findFirst({
    where: and(eq(schema.giftCards.shopId, shopId), eq(schema.giftCards.codeHash, createHash("sha256").update(normalized).digest("hex"))),
    columns: { last4: true, currency: true, initialMinor: true, balanceMinor: true, disabledAt: true, usableFrom: true, expiresAt: true },
  });
  if (!card) return null;
  return {
    last4: card.last4,
    currency: card.currency,
    initialMinor: card.initialMinor,
    balanceMinor: card.balanceMinor,
    /** A bonus card's dates: it can be spent from `usableFrom`, and not from `expiresAt`. */
    usableFrom: card.usableFrom,
    expiresAt: card.expiresAt,
    status: card.disabledAt ? ("off" as const) : card.balanceMinor <= 0 ? ("used" as const) : ("ok" as const),
  };
}
