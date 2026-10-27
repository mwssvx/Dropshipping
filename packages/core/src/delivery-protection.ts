// Delivery protection. Parcels from suppliers travel far and some go missing or arrive broken. A
// store can offer buyers protection at checkout for a small share of the order: if a protected
// order is lost or arrives damaged, the merchant sends it again for free (a replacement order).
// It's never ticked for the buyer; they choose it. What they pay goes to the merchant, who pays
// for the replacements.
import { eq } from "drizzle-orm";
import { schema, type Db, type DeliveryProtection } from "@sf/db";
import { UserError } from "./errors";

export const MAX_PROTECTION_PERCENT = 10;

/** What protection costs on goods worth this much, after discounts. Zero when nothing ships. */
export function protectionFee(protection: DeliveryProtection, goodsMinor: number) {
  if (goodsMinor <= 0) return 0;
  return Math.max(protection.minMinor, Math.round((goodsMinor * protection.percent) / 100));
}

/** Turns delivery protection on with its price, or off (null). */
export async function setDeliveryProtection(db: Db, shopId: string, input: DeliveryProtection | null) {
  if (input) {
    if (!Number.isFinite(input.percent) || input.percent < 0.5 || input.percent > MAX_PROTECTION_PERCENT) {
      throw new UserError(`Pick between 0.5% and ${MAX_PROTECTION_PERCENT}% of the order.`);
    }
    if (!Number.isInteger(input.minMinor) || input.minMinor < 0 || input.minMinor > 10_000) throw new UserError("Keep the lowest price between 0 and 100.");
  }
  const value = input ? { percent: Math.round(input.percent * 10) / 10, minMinor: input.minMinor } : null;
  await db.update(schema.shops).set({ deliveryProtection: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}
