import { and, asc, count, eq, inArray } from "drizzle-orm";
import { COLLECTION_SORTS, schema, type Db } from "@sf/db";
import { z } from "zod";
import { applyRules, collectionRulesSchema, type CollectionRules } from "./collection-rules";
import { NotFoundError, UserError } from "./errors";
import { uniqueHandle } from "./handles";
import { listActiveProducts } from "./products";
import { placeSoldOut, productSoldOut, quickAddVariant, quickPickOptions, soldOutDisplay } from "./badges";
import { cardSwatches } from "./swatches";
import { productRatings, storeReviews } from "./reviews";
import { secondPhoto } from "./gallery";
import { unitsSold } from "./search";

/** "all" is every active product. It isn't stored, so no collection can take that handle. */
export const ALL_COLLECTION = "all";

const collectionInput = z.object({
  title: z.string().trim().min(1, "Give the collection a title.").max(120),
  description: z.string().max(5000).default(""),
  imageUrl: z
    .string()
    .trim()
    .refine((u) => u === "" || /^https:\/\/[^\s]+$/.test(u), "Image must be an https address.")
    .default("")
    .transform((u) => u || null),
  productIds: z.array(z.string().uuid()).max(500).default([]),
  /** Set for an automatic collection; its products then come from the rules, not productIds. */
  rules: collectionRulesSchema.nullable().default(null),
  /** The order its page lists products in; left out, an update keeps the one it has. */
  sortOrder: z.enum(COLLECTION_SORTS, { error: "Pick how the collection is sorted." }).optional(),
});
export type CollectionInput = z.input<typeof collectionInput>;

function parse(input: CollectionInput) {
  const parsed = collectionInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  return parsed.data;
}

async function setProducts(tx: Db, shopId: string, collectionId: string, productIds: string[]) {
  const ids = [...new Set(productIds)];
  if (ids.length) {
    const owned = await tx
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids)));
    if (owned.length !== ids.length) throw new UserError("One of those products isn't in this store.");
  }
  await tx.delete(schema.collectionProducts).where(eq(schema.collectionProducts.collectionId, collectionId));
  if (ids.length) {
    await tx.insert(schema.collectionProducts).values(ids.map((productId, position) => ({ collectionId, productId, position })));
  }
}

export async function createCollection(db: Db, shopId: string, input: CollectionInput) {
  const { productIds, rules, ...data } = parse(input);
  const handle = await uniqueHandle(data.title, async (h) =>
    h === ALL_COLLECTION ||
    !!(await db.query.collections.findFirst({
      where: and(eq(schema.collections.shopId, shopId), eq(schema.collections.handle, h)),
      columns: { id: true },
    })),
  );
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.collections).values({ ...data, rules, shopId, handle }).returning();
    await setProducts(tx as unknown as Db, shopId, row!.id, rules ? [] : productIds);
    return row!;
  });
}

export async function updateCollection(db: Db, shopId: string, collectionId: string, input: CollectionInput) {
  const { productIds, rules, ...data } = parse(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.collections)
      .set({ ...data, rules, updatedAt: new Date() })
      .where(and(eq(schema.collections.id, collectionId), eq(schema.collections.shopId, shopId)))
      .returning();
    if (!row) throw new NotFoundError("Collection");
    await setProducts(tx as unknown as Db, shopId, row.id, rules ? [] : productIds);
    return row;
  });
}

export async function deleteCollection(db: Db, shopId: string, collectionId: string) {
  const [row] = await db
    .delete(schema.collections)
    .where(and(eq(schema.collections.id, collectionId), eq(schema.collections.shopId, shopId)))
    .returning({ id: schema.collections.id });
  if (!row) throw new NotFoundError("Collection");
  await db.delete(schema.translations).where(and(eq(schema.translations.shopId, shopId), eq(schema.translations.kind, "collection"), eq(schema.translations.refId, collectionId)));
}

export async function listCollections(db: Db, shopId: string) {
  const rows = await db.query.collections.findMany({
    where: eq(schema.collections.shopId, shopId),
    orderBy: asc(schema.collections.title),
  });
  if (!rows.length) return [];
  const counts = await db
    .select({ id: schema.collectionProducts.collectionId, n: count() })
    .from(schema.collectionProducts)
    .where(inArray(schema.collectionProducts.collectionId, rows.map((r) => r.id)))
    .groupBy(schema.collectionProducts.collectionId);
  const active = rows.some((r) => r.rules) ? await listActiveProducts(db, shopId) : [];
  const now = new Date();
  return rows.map((r) => ({
    ...r,
    // An automatic collection counts what's on sale and matching right now.
    productCount: r.rules ? applyRules(active, r.rules, now).length : (counts.find((c) => c.id === r.id)?.n ?? 0),
  }));
}

export async function getCollection(db: Db, shopId: string, collectionId: string) {
  const row = await db.query.collections.findFirst({
    where: and(eq(schema.collections.id, collectionId), eq(schema.collections.shopId, shopId)),
  });
  if (!row) throw new NotFoundError("Collection");
  if (row.rules) return { ...row, productIds: [] as string[] };
  const links = await db.query.collectionProducts.findMany({
    where: eq(schema.collectionProducts.collectionId, row.id),
    orderBy: asc(schema.collectionProducts.position),
  });
  return { ...row, productIds: links.map((l) => l.productId) };
}

type ActiveProduct = Awaited<ReturnType<typeof listActiveProducts>>[number];

/**
 * Active products of a collection, in the merchant's order (or the rules' order, for an automatic
 * one). Pass a preloaded list to avoid a query.
 */
export async function collectionProducts(db: Db, shopId: string, collectionId: string | null, all?: ActiveProduct[], rules?: CollectionRules | null) {
  const products = all ?? (await listActiveProducts(db, shopId));
  if (!collectionId) return products;
  const auto =
    rules !== undefined
      ? rules
      : ((await db.query.collections.findFirst({ where: eq(schema.collections.id, collectionId), columns: { rules: true } }))?.rules ?? null);
  if (auto) return applyRules(products, auto);
  const links = await db.query.collectionProducts.findMany({
    where: eq(schema.collectionProducts.collectionId, collectionId),
    orderBy: asc(schema.collectionProducts.position),
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  return links.map((l) => byId.get(l.productId)).filter((p): p is ActiveProduct => !!p);
}

/** Storefront collection page. The "all" handle lists every active product. */
export async function getCollectionByHandle(db: Db, shopId: string, handle: string) {
  if (handle === ALL_COLLECTION) {
    return {
      collection: { id: null, title: "All products", handle: ALL_COLLECTION, description: "", imageUrl: null },
      products: await listActiveProducts(db, shopId),
    };
  }
  const row = await db.query.collections.findFirst({
    where: and(eq(schema.collections.shopId, shopId), eq(schema.collections.handle, handle)),
  });
  if (!row) throw new NotFoundError("Collection");
  return { collection: row, products: await collectionProducts(db, shopId, row.id, undefined, row.rules) };
}

/**
 * Everything the home page sections can show: active products and each collection's
 * product order. Plain data, so the editor preview can render the same sections in the browser.
 */
export async function storefrontCatalog(db: Db, shopId: string) {
  const [all, mode, reviews] = await Promise.all([listActiveProducts(db, shopId), soldOutDisplay(db, shopId), storeReviews(db, shopId)]);
  const now = new Date();
  const soldOut = new Set(all.filter((p) => productSoldOut(p, now)).map((p) => p.id));
  const active = placeSoldOut(all, mode, (p) => soldOut.has(p.id));
  const [units, ratings] = await Promise.all([unitsSold(db, shopId, active.map((p) => p.id)), productRatings(db, shopId, active.map((p) => p.id))]);
  const products = active.map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    imageUrl: p.imageUrl,
    hoverImageUrl: secondPhoto(p),
    priceMinor: p.variants[0]?.priceMinor ?? 0,
    compareAtMinor: p.variants[0]?.compareAtMinor ?? null,
    contents: p.variants[0]?.contents ?? null,
    badge: p.badge,
    createdAt: p.createdAt,
    soldOut: soldOut.has(p.id),
    swatches: cardSwatches(p),
    quickAdd: quickAddVariant(p),
    quickPick: quickPickOptions(p),
    sold: units.get(p.id) ?? 0,
    rating: ratings.get(p.id) ?? null,
  }));
  const rows = await db.query.collections.findMany({ where: eq(schema.collections.shopId, shopId), orderBy: asc(schema.collections.title) });
  const links = rows.length
    ? await db.query.collectionProducts.findMany({
        where: inArray(schema.collectionProducts.collectionId, rows.map((r) => r.id)),
        orderBy: asc(schema.collectionProducts.position),
      })
    : [];
  const collections = rows.map((c) => ({
    id: c.id,
    title: c.title,
    handle: c.handle,
    imageUrl: c.imageUrl,
    productIds: placeSoldOut(
      c.rules ? applyRules(all, c.rules, now).map((p) => p.id) : links.filter((l) => l.collectionId === c.id).map((l) => l.productId),
      mode,
      (id) => soldOut.has(id),
    ),
  }));
  return { products, collections, reviews };
}
export type StorefrontCatalog = Awaited<ReturnType<typeof storefrontCatalog>>;

/**
 * Which of these collections each product is in, for manual and automatic collections alike. Only
 * active products are checked against rules, as only they can be bought or shown.
 */
export async function collectionMembership(db: Db, shopId: string, collectionIds: string[], productIds?: string[]) {
  const result = new Map<string, Set<string>>();
  const ids = [...new Set(collectionIds)];
  if (!ids.length) return result;
  const rows = await db.query.collections.findMany({ where: and(eq(schema.collections.shopId, shopId), inArray(schema.collections.id, ids)), columns: { id: true, rules: true } });
  for (const r of rows) result.set(r.id, new Set());
  const manual = rows.filter((r) => !r.rules).map((r) => r.id);
  if (manual.length && (!productIds || productIds.length)) {
    const links = await db.query.collectionProducts.findMany({
      where: productIds
        ? and(inArray(schema.collectionProducts.collectionId, manual), inArray(schema.collectionProducts.productId, productIds))
        : inArray(schema.collectionProducts.collectionId, manual),
    });
    for (const l of links) result.get(l.collectionId)!.add(l.productId);
  }
  const auto = rows.filter((r) => r.rules);
  if (auto.length) {
    const wanted = productIds ? new Set(productIds) : null;
    const active = (await listActiveProducts(db, shopId)).filter((p) => !wanted || wanted.has(p.id));
    const now = new Date();
    for (const r of auto) for (const p of applyRules(active, r.rules!, now)) result.get(r.id)!.add(p.id);
  }
  return result;
}

/** The collections a product is in. */
export async function collectionsOfProduct(db: Db, shopId: string, productId: string) {
  const all = await db.query.collections.findMany({ where: eq(schema.collections.shopId, shopId), columns: { id: true } });
  const membership = await collectionMembership(db, shopId, all.map((c) => c.id), [productId]);
  return [...membership].filter(([, members]) => members.has(productId)).map(([id]) => id);
}
