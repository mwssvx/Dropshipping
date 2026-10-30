import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { matchesRules, type RuleProduct } from "./collection-rules";

/*
 * Breadcrumbs on product pages: Home › Lamps › Sunset Projection Lamp. The middle step is the
 * collection the shopper came from when the product is in it, else the first collection the
 * product is in, so the trail always leads somewhere real.
 */

export type Crumb = { id: string; title: string; handle: string };

/** The collection handle in a store page address, like /s/lumen/collections/lamps. */
export function collectionFromReferer(referer: string | null | undefined, base: string): string | null {
  if (!referer) return null;
  let path: string;
  try {
    path = new URL(referer).pathname;
  } catch {
    return null;
  }
  if (base && !path.startsWith(`${base}/`)) return null;
  const m = /^\/collections\/([^/]+)\/?$/.exec(base ? path.slice(base.length) : path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

/** The collection to show between Home and the product, or null when it's in none. */
export async function breadcrumbCollection(db: Db, shopId: string, product: RuleProduct & { id: string }, fromHandle?: string | null): Promise<Crumb | null> {
  const now = new Date();
  const has = async (c: { id: string; rules: typeof schema.collections.$inferSelect.rules }) => {
    if (c.rules) return matchesRules(product, c.rules, now);
    const link = await db.query.collectionProducts.findFirst({
      where: and(eq(schema.collectionProducts.collectionId, c.id), eq(schema.collectionProducts.productId, product.id)),
      columns: { productId: true },
    });
    return !!link;
  };
  const columns = { id: true, title: true, handle: true, rules: true } as const;
  if (fromHandle) {
    const from = await db.query.collections.findFirst({ where: and(eq(schema.collections.shopId, shopId), eq(schema.collections.handle, fromHandle)), columns });
    if (from && (await has(from))) return { id: from.id, title: from.title, handle: from.handle };
  }
  // Collections picked by hand say more about a product than ones filled by rules, so they come first.
  const manual = await db
    .select({ id: schema.collections.id, title: schema.collections.title, handle: schema.collections.handle })
    .from(schema.collectionProducts)
    .innerJoin(schema.collections, eq(schema.collections.id, schema.collectionProducts.collectionId))
    .where(and(eq(schema.collections.shopId, shopId), eq(schema.collectionProducts.productId, product.id), isNull(schema.collections.rules)))
    .orderBy(asc(schema.collections.createdAt), asc(schema.collections.title))
    .limit(1);
  if (manual[0]) return manual[0];
  const auto = await db.query.collections.findMany({
    where: and(eq(schema.collections.shopId, shopId), isNotNull(schema.collections.rules)),
    columns,
    orderBy: [asc(schema.collections.createdAt), asc(schema.collections.title)],
  });
  const hit = auto.find((c) => matchesRules(product, c.rules!, now));
  return hit ? { id: hit.id, title: hit.title, handle: hit.handle } : null;
}
