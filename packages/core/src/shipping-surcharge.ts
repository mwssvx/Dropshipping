// Extra shipping for bulky or heavy products. A rug, a chair or a mirror costs the supplier far more
// to send than a phone case, but most stores have one shipping price for everything. The merchant
// sets an amount per product, and checkout adds it to the shipping rate for each one in the parcel.
// It still applies when the rate itself is free (over the free-shipping amount), so free shipping
// on small things doesn't mean selling a sofa at a loss. Pickup and the store's own delivery don't
// add it, and neither does a free-shipping code.
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

/** The most a product can add to shipping, in minor units (1,000.00). */
export const SHIPPING_SURCHARGE_MAX = 100_000;

export async function setShippingSurcharge(db: Db, shopId: string, productId: string, amountMinor: number) {
  if (!(Number.isInteger(amountMinor) && amountMinor >= 0 && amountMinor <= SHIPPING_SURCHARGE_MAX)) {
    throw new UserError("Enter an amount from 0 to 1,000, or 0 for no extra shipping.");
  }
  const [row] = await db
    .update(schema.products)
    .set({ shippingSurchargeMinor: amountMinor, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ shippingSurchargeMinor: schema.products.shippingSurchargeMinor });
  if (!row) throw new NotFoundError("Product");
  return row;
}

/** What the products in a parcel add to its shipping: each one's amount times how many. */
export const surchargeFor = (lines: { quantity: number; product: { shippingSurchargeMinor: number; giftCard?: boolean; digital?: boolean } }[]) =>
  lines.reduce((sum, l) => (l.product.giftCard || l.product.digital ? sum : sum + l.product.shippingSurchargeMinor * l.quantity), 0);
