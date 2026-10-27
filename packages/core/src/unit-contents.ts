// Saving what each variant holds, for the price per unit (see unit-price.ts).
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { parseContents } from "./unit-price";

/** Sets or clears each variant's contents; a blank amount clears it. */
export async function setVariantContents(db: Db, shopId: string, productId: string, rows: { variantId: string; amount: string; unit: string }[]) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)), columns: { id: true, giftCard: true } });
  if (!product) throw new NotFoundError("Product");
  if (product.giftCard) throw new UserError("Gift cards don't have a price per unit.");
  const variants = rows.length ? await db.query.variants.findMany({ where: and(eq(schema.variants.productId, product.id), inArray(schema.variants.id, rows.map((r) => r.variantId))), columns: { id: true, title: true } }) : [];
  const byId = new Map(variants.map((v) => [v.id, v]));
  const parsed = rows.map((r) => {
    const v = byId.get(r.variantId);
    if (!v) throw new NotFoundError("Variant");
    try {
      return { id: v.id, contents: parseContents(r.amount, r.unit) };
    } catch {
      throw new UserError(`${v.title === "Default" ? "The contents" : `The contents of ${v.title}`} should be a number above 0, like 250 or 1.5.`);
    }
  });
  await db.transaction(async (tx) => {
    for (const p of parsed) await tx.update(schema.variants).set({ contents: p.contents }).where(eq(schema.variants.id, p.id));
  });
  return parsed.filter((p) => p.contents).length;
}
