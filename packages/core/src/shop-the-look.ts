// "Shop the look": a home page section with one photo beside the products in it. Its button adds
// every piece that has nothing to choose, so a styled room or an outfit goes into the cart in one tap.
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { quickAddVariant } from "./badges";
import { LOOK_MAX } from "./theme-doc";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The options a look's button may add, from what the page sent: each must be the one option of a
 * product on sale in this shop that a card could add straight away, so nothing hidden, sold out,
 * personalised or with options to pick slips in. Order kept, repeats dropped.
 */
export async function lookVariants(db: Db, shopId: string, sent: string[]) {
  const ids = [...new Set(sent.filter((id) => UUID.test(id)))].slice(0, LOOK_MAX);
  if (!ids.length) return [];
  const products = await db
    .select({ id: schema.products.id, personalization: schema.products.personalization, purchaseLimit: schema.products.purchaseLimit })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(inArray(schema.variants.id, ids), eq(schema.products.shopId, shopId), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)));
  if (!products.length) return [];
  const variants = await db
    .select({ id: schema.variants.id, productId: schema.variants.productId, stock: schema.variants.stock })
    .from(schema.variants)
    .where(inArray(schema.variants.productId, products.map((p) => p.id)));
  const ok = new Set(
    products.map((p) => quickAddVariant({ ...p, variants: variants.filter((v) => v.productId === p.id) })).filter((id): id is string => !!id),
  );
  return ids.filter((id) => ok.has(id));
}
