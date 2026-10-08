import { and, asc, count, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { uniqueHandle } from "./handles";
import { listActiveProducts } from "./products";

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
  const { productIds, ...data } = parse(input);
  const handle = await uniqueHandle(data.title, async (h) =>
    h === ALL_COLLECTION ||
    !!(await db.query.collections.findFirst({
      where: and(eq(schema.collections.shopId, shopId), eq(schema.collections.handle, h)),
      columns: { id: true },
    })),
  );
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(schema.collections).values({ ...data, shopId, handle }).returning();
    await setProducts(tx as unknown as Db, shopId, row!.id, productIds);
    return row!;
  });
}

export async function updateCollection(db: Db, shopId: string, collectionId: string, input: CollectionInput) {
  const { productIds, ...data } = parse(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.collections)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.collections.id, collectionId), eq(schema.collections.shopId, shopId)))
      .returning();
    if (!row) throw new NotFoundError("Collection");
    await setProducts(tx as unknown as Db, shopId, row.id, productIds);
    return row;
  });
}

export async function deleteCollection(db: Db, shopId: string, collectionId: string) {
  const [row] = await db
    .delete(schema.collections)
    .where(and(eq(schema.collections.id, collectionId), eq(schema.collections.shopId, shopId)))
    .returning({ id: schema.collections.id });
  if (!row) throw new NotFoundError("Collection");
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
  return rows.map((r) => ({ ...r, productCount: counts.find((c) => c.id === r.id)?.n ?? 0 }));
}

export async function getCollection(db: Db, shopId: string, collectionId: string) {
  const row = await db.query.collections.findFirst({
    where: and(eq(schema.collections.id, collectionId), eq(schema.collections.shopId, shopId)),
  });
  if (!row) throw new NotFoundError("Collection");
  const links = await db.query.collectionProducts.findMany({
    where: eq(schema.collectionProducts.collectionId, row.id),
    orderBy: asc(schema.collectionProducts.position),
  });
  return { ...row, productIds: links.map((l) => l.productId) };
}

type ActiveProduct = Awaited<ReturnType<typeof listActiveProducts>>[number];

/** Active products of a collection, in the merchant's order. Pass a preloaded list to avoid a query. */
export async function collectionProducts(db: Db, shopId: string, collectionId: string | null, all?: ActiveProduct[]) {
  const products = all ?? (await listActiveProducts(db, shopId));
  if (!collectionId) return products;
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
  return { collection: row, products: await collectionProducts(db, shopId, row.id) };
}

/**
 * Everything the home page sections can show: active products and each collection's
 * product order. Plain data, so the editor preview can render the same sections in the browser.
 */
export async function storefrontCatalog(db: Db, shopId: string) {
  const products = (await listActiveProducts(db, shopId)).map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    imageUrl: p.imageUrl,
    priceMinor: p.variants[0]?.priceMinor ?? 0,
    compareAtMinor: p.variants[0]?.compareAtMinor ?? null,
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
    productIds: links.filter((l) => l.collectionId === c.id).map((l) => l.productId),
  }));
  return { products, collections };
}
export type StorefrontCatalog = Awaited<ReturnType<typeof storefrontCatalog>>;
