// Age-restricted products. Alcohol, vapes, knives and the like can only be sold to buyers old
// enough to buy them where they live. A product carries the age it needs; the store's checkout
// asks the buyer to confirm they're at least that old, and the order keeps what they confirmed so
// the merchant (and the courier, for alcohol) knows to check ID on delivery.
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

export const MIN_AGE_LOW = 13;
export const MIN_AGE_HIGH = 25;

/** Sets the age a buyer must be to buy a product, or clears it with null. */
export async function setMinAge(db: Db, shopId: string, productId: string, minAge: number | null) {
  if (minAge !== null && !(Number.isInteger(minAge) && minAge >= MIN_AGE_LOW && minAge <= MIN_AGE_HIGH)) {
    throw new UserError(`Pick an age from ${MIN_AGE_LOW} to ${MIN_AGE_HIGH}, or none.`);
  }
  const [row] = await db
    .update(schema.products)
    .set({ minAge, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning({ minAge: schema.products.minAge });
  if (!row) throw new NotFoundError("Product");
  return row;
}
