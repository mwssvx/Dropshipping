// Gift wrapping. A store can wrap gifts for a price it sets, the kind of thing other platforms
// sell as an app. Buyers who tick "This order is a gift" can add it at checkout; it's never ticked
// for them. What they pay is the merchant's, and the packing slip says to wrap it.
import { eq } from "drizzle-orm";
import { schema, type Db, type GiftWrap } from "@sf/db";
import { UserError } from "./errors";

export const MAX_GIFT_WRAP_NOTE = 120;

/** Turns gift wrapping on with its price and what buyers get, or off (null). */
export async function setGiftWrap(db: Db, shopId: string, input: { priceMinor: number; note?: string | null } | null) {
  let value: GiftWrap | null = null;
  if (input) {
    if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0 || input.priceMinor > 10_000) throw new UserError("Keep the wrapping price between 0 and 100.");
    const note = (input.note ?? "").trim() || null;
    if (note && note.length > MAX_GIFT_WRAP_NOTE) throw new UserError(`Keep the description under ${MAX_GIFT_WRAP_NOTE} characters.`);
    value = { priceMinor: input.priceMinor, note };
  }
  await db.update(schema.shops).set({ giftWrap: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}
