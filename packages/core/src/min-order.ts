// The smallest order a store takes ("Orders start at $15"). A $4 order can cost more to pack and
// send than it earns, which hurts dropshippers most. It counts the goods after discounts, so a code
// can't take an order under it; gift cards on their own, wholesale orders (they have their own
// minimum), after-checkout offers and repeat deliveries don't count. The cart says how much more
// it takes and checkout won't start until the order gets there.
import { eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";

/** The highest minimum a store can set: 1,000 in its currency. */
export const MAX_MIN_ORDER_MINOR = 100_000;

/** Sets the smallest order, in minor units; 0 takes any amount. */
export async function setMinOrder(db: Db, shopId: string, minor: number) {
  if (!Number.isInteger(minor) || minor < 0 || minor > MAX_MIN_ORDER_MINOR) throw new UserError("Keep the smallest order between 0 and 1,000.");
  await db.update(schema.shops).set({ minOrderMinor: minor, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return minor;
}

/** How far goods costing `paidMinor` (after discounts) are from the store's minimum, or null when there's none. */
export function minimumOrder(shop: Pick<typeof schema.shops.$inferSelect, "minOrderMinor">, paidMinor: number) {
  if (!shop.minOrderMinor) return null;
  return { minMinor: shop.minOrderMinor, shortByMinor: Math.max(0, shop.minOrderMinor - paidMinor) };
}
