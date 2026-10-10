// Recently viewed: the store remembers the last products a shopper opened (in a cookie on their
// device, nothing on the server) and shows them on product pages and in the cart.
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";

export const MAX_RECENT = 12;

/** The ids from the cookie, newest first, cleaned up. */
export function recentIdsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x));
  return [...new Set(ids)].slice(0, MAX_RECENT);
}

/** The ids after viewing a product: it moves to the front. */
export function addRecentId(ids: string[], productId: string) {
  return recentIdsFrom([productId, ...ids.filter((id) => id !== productId)]);
}

/**
 * Products still on sale, newest view first, with their first option in stock (or the first
 * option, when all are sold out). Gift cards and the ids in `exclude` are left out.
 */
export async function recentlyViewed(db: Db, shopId: string, ids: string[], opts: { exclude?: string[]; limit?: number } = {}) {
  const wanted = recentIdsFrom(ids).filter((id) => !opts.exclude?.includes(id));
  if (!wanted.length) return [];
  const products = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, wanted), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)),
  });
  if (!products.length) return [];
  const variants = await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)), orderBy: asc(schema.variants.position) });
  return wanted
    .map((id) => products.find((p) => p.id === id))
    .filter((p) => !!p)
    .map((p) => {
      const mine = variants.filter((v) => v.productId === p.id);
      const v = mine.find((x) => x.stock === null || x.stock > 0) ?? mine[0];
      return v ? { id: p.id, handle: p.handle, title: p.title, imageUrl: p.imageUrl, variantId: v.id, priceMinor: v.priceMinor, soldOut: v.stock !== null && v.stock <= 0 } : null;
    })
    .filter((x) => x !== null)
    .slice(0, opts.limit ?? 6);
}
