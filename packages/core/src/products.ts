import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { MAX_WEIGHT_GRAMS } from "./weight";
import { BARCODE_MAX, BarcodeError } from "./barcode";
import { recordStockEdits } from "./own-stock";
import { uniqueHandle } from "./handles";
import { editProductPhotos, inheritedPhoto, photoColumns } from "./gallery";
import { publishDueProducts } from "./publish-later";
import { groupBy } from "./group";
import { normalizeTags } from "./customers";

export const MAX_VARIANTS = 100;
export const MAX_OPTIONS = 3;
export const MAX_PRODUCT_TAGS = 20;

const variantInput = z.object({
  /** An existing option of this product, to edit it in place; leave out to add one. */
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).default("Default"),
  priceMinor: z.number().int().min(0, "Price can't be negative."),
  compareAtMinor: z.number().int().min(0).nullish(),
  costMinor: z.number().int().min(0).nullish(),
  sku: z.string().trim().max(100, "Keep the SKU under 100 characters.").nullish(),
  /** The UPC, EAN or the store's own code a scanner reads. */
  barcode: z
    .string()
    .trim()
    .max(BARCODE_MAX, new BarcodeError().message)
    .regex(/^[\x20-\x7e]*$/, new BarcodeError().message)
    .nullish()
    .transform((v) => (v === "" ? null : v)),
  /** Where it sits on the shelf, like A3. */
  location: z
    .string()
    .trim()
    .max(40, "Keep the shelf location under 40 characters.")
    .nullish()
    .transform((v) => (v === "" ? null : v)),
  stock: z.number().int().nullish(),
  /** What one weighs packed, in grams, for shipping rates that go by weight. */
  weightGrams: z.number().int().min(1, "Leave the weight empty, or enter more than 0.").max(MAX_WEIGHT_GRAMS, "Keep the weight under 1,000 kg.").nullish(),
  /** Named options like { Color: "Black", Size: "XL" }, which shoppers can filter by. */
  options: z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(60)).optional(),
});

const productInput = z.object({
  title: z.string().trim().min(1, "Give the product a title.").max(200),
  descriptionHtml: z.string().max(50_000).default(""),
  imageUrl: z
    .string()
    .trim()
    .url("Image must be a full web address.")
    .refine((u) => u.startsWith("https://"), "Image must be an https address.")
    .nullish()
    .or(z.literal("").transform(() => null)),
  status: z.enum(["draft", "active", "archived"]).default("draft"),
  variants: z.array(variantInput).min(1, "Add at least one price.").max(MAX_VARIANTS, `A product can have up to ${MAX_VARIANTS} options.`),
  /** "summer, gift idea" or a list; left out, the product keeps the tags it has. */
  tags: z.union([z.string(), z.array(z.string())]).optional(),
});

export type ProductInput = z.input<typeof productInput>;

function parse(input: ProductInput) {
  const parsed = productInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { tags, ...data } = parsed.data;
  return { ...data, ...(tags === undefined ? {} : { tags: normalizeTags(tags, "A product", MAX_PRODUCT_TAGS) }) };
}

export async function createProduct(db: Db, shopId: string, input: ProductInput) {
  const { variants, imageUrl, ...data } = parse(input);
  const handle = await uniqueHandle(data.title, async (h) =>
    !!(await db.query.products.findFirst({
      where: and(eq(schema.products.shopId, shopId), eq(schema.products.handle, h)),
      columns: { id: true },
    })),
  );
  return db.transaction(async (tx) => {
    const [product] = await tx.insert(schema.products).values({ ...data, ...photoColumns(imageUrl ? [imageUrl] : []), shopId, handle }).returning();
    await tx.insert(schema.variants).values(variants.map(({ id: _id, ...v }, i) => ({ ...v, productId: product!.id, position: i })));
    await checkBarcodes(tx as unknown as Db, shopId, product!.id, variants);
    await recordStockEdits(tx as unknown as Db, product!.id, new Map());
    return product!;
  });
}

/**
 * Copies a product as a draft: its photos, options, prices, supplier listing and settings, and the
 * collections and size charts it's in. Reviews, questions and translations stay with the original.
 * Products the merchant stocks themselves start at 0 so stock isn't counted twice; supplier
 * products keep the supplier's numbers until the next stock check.
 */
export async function duplicateProduct(db: Db, shopId: string, productId: string) {
  const { variants: vs, ...original } = await getProduct(db, shopId, productId);
  const title = `Copy of ${original.title}`.slice(0, 200);
  const handle = await uniqueHandle(title, async (h) =>
    !!(await db.query.products.findFirst({
      where: and(eq(schema.products.shopId, shopId), eq(schema.products.handle, h)),
      columns: { id: true },
    })),
  );
  const { id: _id, createdAt: _c, updatedAt: _u, stockCheckedAt: _s, publishAt: _p, ...fields } = original;
  return db.transaction(async (tx) => {
    const [copy] = await tx.insert(schema.products).values({ ...fields, title, handle, status: "draft" }).returning();
    const ids = new Map<string, string>();
    for (const { id, ...v } of vs) {
      const [row] = await tx
        .insert(schema.variants)
        // Barcodes stay with the original: two products can't scan as the same thing.
        .values({ ...v, productId: copy!.id, barcode: null, stock: original.supplierId || v.stock === null ? v.stock : 0 })
        .returning({ id: schema.variants.id });
      ids.set(id, row!.id);
    }
    // The backup supplier's listing is kept per option, so it follows the new option ids.
    if (original.backup) {
      const variants = Object.fromEntries(Object.entries(original.backup.variants).flatMap(([k, b]) => (ids.has(k) ? [[ids.get(k)!, b]] : [])));
      await tx.update(schema.products).set({ backup: { ...original.backup, variants } }).where(eq(schema.products.id, copy!.id));
    }
    const inCollections = await tx.query.collectionProducts.findMany({ where: eq(schema.collectionProducts.productId, productId) });
    if (inCollections.length) await tx.insert(schema.collectionProducts).values(inCollections.map((c) => ({ ...c, productId: copy!.id })));
    const charts = await tx.query.sizeCharts.findMany({ where: eq(schema.sizeCharts.shopId, shopId) });
    for (const c of charts.filter((c) => c.productIds.includes(productId))) {
      await tx.update(schema.sizeCharts).set({ productIds: [...c.productIds, copy!.id] }).where(eq(schema.sizeCharts.id, c.id));
    }
    return copy!;
  });
}

export async function updateProduct(db: Db, shopId: string, productId: string, input: ProductInput) {
  const { variants, imageUrl, ...data } = parse(input);
  // Photos have their own editor; an image address given here (the API) becomes the cover.
  if (imageUrl) await editProductPhotos(db, shopId, productId, { kind: "add", url: imageUrl, cover: true });
  return db.transaction(async (tx) => {
    const [product] = await tx
      .update(schema.products)
      // A product put on sale (or archived) by hand no longer waits for its scheduled time.
      .set({ ...data, ...(data.status === "draft" ? {} : { publishAt: null }), updatedAt: new Date() })
      .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
      .returning();
    if (!product) throw new NotFoundError("Product");
    const existing = await tx.query.variants.findMany({
      where: eq(schema.variants.productId, productId),
      orderBy: asc(schema.variants.position),
    });
    // Options sent with their id are edited in place, so orders, alerts and supplier links keep
    // pointing at the same one; without ids (older forms, the API) they're matched by position.
    const byId = variants.some((v) => v.id);
    const kept = new Set<string>();
    for (const [i, { id, ...v }] of variants.entries()) {
      const row = byId ? (id ? existing.find((e) => e.id === id) : undefined) : existing[i];
      if (byId && id && !row) throw new UserError("One of those options was removed meanwhile. Reload the page and try again.");
      // Renaming a one-option variant ("Small" to "S") renames the option the filters show too.
      const own = Object.entries(row?.options ?? {});
      const options = v.options ?? (row && own.length === 1 && own[0]![1] === row.title && v.title !== row.title ? { [own[0]![0]]: v.title } : undefined);
      if (row) {
        await tx.update(schema.variants).set({ ...v, options, position: i }).where(eq(schema.variants.id, row.id));
        kept.add(row.id);
      } else await tx.insert(schema.variants).values({ ...v, productId, position: i, imageUrl: inheritedPhoto(existing, v.options) });
    }
    const extra = existing.filter((e) => !kept.has(e.id)).map((e) => e.id);
    if (extra.length) await tx.delete(schema.variants).where(inArray(schema.variants.id, extra));
    await checkBarcodes(tx as unknown as Db, shopId, productId, variants);
    await recordStockEdits(tx as unknown as Db, productId, new Map(existing.map((e) => [e.id, e.stock])));
    return product;
  });
}

/** After saving, no two options in the store may share a barcode just given; the save is undone if they do. */
async function checkBarcodes(db: Db, shopId: string, productId: string, variants: { barcode?: string | null }[]) {
  const given = [...new Set(variants.map((v) => v.barcode).filter((b): b is string => !!b))];
  if (!given.length) return;
  const rows = await db
    .select({ barcode: schema.variants.barcode, position: schema.variants.position, productId: schema.variants.productId, product: schema.products.title, option: schema.variants.title })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(eq(schema.products.shopId, shopId), inArray(schema.variants.barcode, given)));
  for (const code of given) {
    const same = rows.filter((r) => r.barcode === code);
    if (same.length < 2) continue;
    // The one that had it before this save, if any.
    const other = same.find((r) => r.productId !== productId || variants[r.position]?.barcode !== code);
    throw new UserError(other ? `${other.option === "Default" ? other.product : `${other.product} (${other.option})`} already has the barcode ${code}.` : `Two options can't share the barcode ${code}.`);
  }
}

export async function listProducts(db: Db, shopId: string) {
  // The admin, the app and the API all list from here, so scheduled drafts show as on sale on time.
  await publishDueProducts(db, shopId);
  return productsWithVariants(db, eq(schema.products.shopId, shopId));
}

/**
 * Products matching `scope`, newest first, each with its variants. The variants come from a
 * subquery rather than a list of ids, which Postgres caps at 65,535 parameters, and are matched
 * up in one pass, so a store with thousands of products lists as fast as one with ten.
 */
async function productsWithVariants(db: Db, scope: SQL | undefined) {
  const rows = await db.query.products.findMany({ where: scope, orderBy: desc(schema.products.createdAt) });
  if (!rows.length) return [];
  const vs = await db
    .select()
    .from(schema.variants)
    .where(inArray(schema.variants.productId, db.select({ id: schema.products.id }).from(schema.products).where(scope)))
    .orderBy(asc(schema.variants.position));
  const byProduct = groupBy(vs, (v) => v.productId);
  return rows.map((p) => ({ ...p, variants: byProduct.get(p.id) ?? [] }));
}

/**
 * Every product's id, title, handle and status, newest first, without options or photos: for the
 * product pickers on admin pages, which don't need the rest and would otherwise load the whole
 * catalog with every option.
 */
export async function productChoices(db: Db, shopId: string) {
  await publishDueProducts(db, shopId);
  return db
    .select({ id: schema.products.id, title: schema.products.title, handle: schema.products.handle, status: schema.products.status, giftCard: schema.products.giftCard })
    .from(schema.products)
    .where(eq(schema.products.shopId, shopId))
    .orderBy(desc(schema.products.createdAt));
}

/** One of the store's products on sale (not a gift card) with its options, newest first, to show examples with; null if there's none. */
export async function sampleProduct(db: Db, shopId: string) {
  await publishDueProducts(db, shopId);
  const [product] = await db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)))
    .orderBy(desc(schema.products.createdAt))
    .limit(1);
  if (!product) return null;
  const variants = await db.select().from(schema.variants).where(eq(schema.variants.productId, product.id)).orderBy(asc(schema.variants.position));
  return { ...product, variants };
}

/** Products on one page of the admin product list. */
export const PRODUCT_PAGE_SIZE = 100;

/**
 * One page of the admin product list, newest first, each with its variants, plus how many match
 * in all. `query` matches the title or an exact SKU.
 */
/** Orders for the admin product list. Price is each product's lowest option price. */
export const PRODUCT_SORTS = ["newest", "oldest", "title", "title_desc", "updated", "price", "price_desc"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

function productOrder(sort: ProductSort) {
  const p = schema.products;
  const price = sql`(select min(${schema.variants.priceMinor}) from ${schema.variants} where ${schema.variants.productId} = ${p.id})`;
  switch (sort) {
    case "oldest":
      return [asc(p.createdAt)];
    case "title":
      return [sql`lower(${p.title}) asc`];
    case "title_desc":
      return [sql`lower(${p.title}) desc`];
    case "updated":
      return [desc(p.updatedAt)];
    // Products with no options yet go last either way.
    case "price":
      return [sql`${price} asc nulls last`];
    case "price_desc":
      return [sql`${price} desc nulls last`];
    default:
      return [desc(p.createdAt)];
  }
}

export const PRODUCT_STOCK_FILTERS = ["in_stock", "low", "sold_out"] as const;
export type ProductStockFilter = (typeof PRODUCT_STOCK_FILTERS)[number];

/**
 * Sold out: every option has a stock count and none are left. Running low: still for sale, but an
 * option is at or under the store's running-low number. In stock: at least one option can be bought.
 * Options without a stock count are always in stock.
 */
function stockWhere(shopId: string, filter: ProductStockFilter) {
  const v = schema.variants;
  const options = (cond: SQL) => sql`exists (select 1 from ${v} where ${v.productId} = ${schema.products.id} and ${cond})`;
  const available = options(sql`(${v.stock} is null or ${v.stock} > 0)`);
  switch (filter) {
    case "in_stock":
      return available;
    case "sold_out":
      return sql`(${options(sql`true`)} and not ${available})`;
    case "low":
      return and(
        available,
        options(sql`${v.stock} is not null and ${v.stock} <= (select ${schema.shops.restockAlertAt} from ${schema.shops} where ${schema.shops.id} = ${shopId})`),
      );
  }
}

export const PRODUCT_SOURCES = ["supplier", "own", "digital", "gift_card"] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

/** Where a product comes from: a supplier ships it, the store ships its own stock, a download, or a gift card. */
function sourceCase() {
  const p = schema.products;
  return sql<ProductSource>`case when ${p.giftCard} then 'gift_card' when ${p.digital} then 'digital' when ${p.sourceUrl} is not null or ${p.supplierId} is not null then 'supplier' else 'own' end`;
}

/** How many of the store's products come from each source, for the list's filter. */
export async function productSources(db: Db, shopId: string) {
  const rows = await db
    .select({ source: sourceCase(), n: sql<number>`count(*)::int` })
    .from(schema.products)
    .where(eq(schema.products.shopId, shopId))
    .groupBy(sourceCase());
  return Object.fromEntries(PRODUCT_SOURCES.map((s) => [s, rows.find((r) => r.source === s)?.n ?? 0])) as Record<ProductSource, number>;
}

/** Things a product still lacks that buyers, shipping rates or customs need. */
export const PRODUCT_GAPS = ["photo", "description", "weight", "customs", "cost"] as const;
export type ProductGap = (typeof PRODUCT_GAPS)[number];

/**
 * Weight and customs only count for products that ship: downloads and gift cards need neither.
 * A description of only tags or spaces counts as none.
 */
function gapWhere(gap: ProductGap) {
  const p = schema.products;
  const ships = sql`not ${p.digital} and not ${p.giftCard}`;
  switch (gap) {
    case "photo":
      return sql`${p.imageUrl} is null`;
    case "description":
      return sql`regexp_replace(regexp_replace(${p.descriptionHtml}, '<[^>]*>', '', 'g'), '&nbsp;|[[:space:]]', '', 'g') = ''`;
    case "weight":
      return sql`${ships} and exists (select 1 from ${schema.variants} v where v.product_id = ${p.id} and v.weight_grams is null)`;
    case "customs":
      return sql`${ships} and (${p.hsCode} is null or ${p.originCountry} is null)`;
    // With no cost, the profit report can't take it off, so the product looks more profitable than it is.
    case "cost":
      return sql`not ${p.giftCard} and exists (select 1 from ${schema.variants} v where v.product_id = ${p.id} and v.cost_minor is null)`;
  }
}

/** How many products not archived lack each thing, for the list's filter. */
export async function productGaps(db: Db, shopId: string) {
  const [row] = await db
    .select(Object.fromEntries(PRODUCT_GAPS.map((g) => [g, sql<number>`count(*) filter (where ${gapWhere(g)})::int`])) as Record<ProductGap, SQL<number>>)
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), ne(schema.products.status, "archived")));
  return Object.fromEntries(PRODUCT_GAPS.map((g) => [g, Number(row?.[g] ?? 0)])) as Record<ProductGap, number>;
}

/** Products with an option that earns little: under 20% of its price, or less than it costs. */
export const PRODUCT_MARGINS = ["low", "loss"] as const;
export type ProductMargin = (typeof PRODUCT_MARGINS)[number];

/** Options with no cost entered can't be judged, so they never count. */
function marginWhere(margin: ProductMargin) {
  const p = schema.products;
  const thin = margin === "loss" ? sql`v.cost_minor > v.price_minor` : sql`v.cost_minor * 5 > v.price_minor * 4`;
  return sql`exists (select 1 from ${schema.variants} v where v.product_id = ${p.id} and v.cost_minor is not null and ${thin})`;
}

/** How many products not archived earn little, for the list's filter. */
export async function productMargins(db: Db, shopId: string) {
  const [row] = await db
    .select(Object.fromEntries(PRODUCT_MARGINS.map((m) => [m, sql<number>`count(*) filter (where ${marginWhere(m)})::int`])) as Record<ProductMargin, SQL<number>>)
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), ne(schema.products.status, "archived")));
  return Object.fromEntries(PRODUCT_MARGINS.map((m) => [m, Number(row?.[m] ?? 0)])) as Record<ProductMargin, number>;
}

/** Products not sold in the last 30 or 90 days: worth a sale, a better photo, or archiving. */
export const PRODUCT_UNSOLD = ["30", "90"] as const;
export type ProductUnsold = (typeof PRODUCT_UNSOLD)[number];

/**
 * No unit in a paid order over the window. Products added within it haven't had their chance yet,
 * so they never count.
 */
function unsoldWhere(days: ProductUnsold) {
  const p = schema.products;
  const since = sql`now() - make_interval(days => ${Number(days)})`;
  return sql`(${p.createdAt} < ${since} and not exists (select 1 from order_lines ol join variants v on v.id = ol.variant_id join orders o on o.id = ol.order_id where v.product_id = ${p.id} and o.payment_status in ('paid', 'partially_refunded') and o.paid_at >= ${since}))`;
}

/** How many products on sale went unsold, for the list's filter. */
export async function productUnsold(db: Db, shopId: string) {
  const [row] = await db
    .select(Object.fromEntries(PRODUCT_UNSOLD.map((d) => [d, sql<number>`count(*) filter (where ${unsoldWhere(d)})::int`])) as Record<ProductUnsold, SQL<number>>)
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), eq(schema.products.status, "active")));
  return Object.fromEntries(PRODUCT_UNSOLD.map((d) => [d, Number(row?.[d] ?? 0)])) as Record<ProductUnsold, number>;
}

/** The product list's search and filters, shared by the page and its spreadsheet download. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** collection: a hand-picked collection's id; products in it. missing: products that lack this. margin: products that earn little. unsold: products on sale with no sale in that many days. */
export type ProductQuery = { query?: string; status?: "active" | "draft" | "archived"; tag?: string; stock?: ProductStockFilter; source?: ProductSource; collection?: string; missing?: ProductGap; margin?: ProductMargin; unsold?: ProductUnsold };

export function productWhere(db: Db, shopId: string, opts: ProductQuery) {
  const q = opts.query?.trim().toLowerCase();
  return and(
    eq(schema.products.shopId, shopId),
    opts.status ? eq(schema.products.status, opts.status) : undefined,
    opts.tag ? sql`${schema.products.tags} @> ${JSON.stringify([opts.tag.trim().toLowerCase()])}::jsonb` : undefined,
    opts.stock ? stockWhere(shopId, opts.stock) : undefined,
    opts.source ? sql`${sourceCase()} = ${opts.source}` : undefined,
    opts.collection && UUID.test(opts.collection)
      ? inArray(schema.products.id, db.select({ id: schema.collectionProducts.productId }).from(schema.collectionProducts).where(eq(schema.collectionProducts.collectionId, opts.collection)))
      : undefined,
    // Archived products aren't worth finishing, so they're left out unless asked for, as in the counts.
    opts.missing && PRODUCT_GAPS.includes(opts.missing) ? and(gapWhere(opts.missing), opts.status ? undefined : ne(schema.products.status, "archived")) : undefined,
    opts.margin && PRODUCT_MARGINS.includes(opts.margin) ? and(marginWhere(opts.margin), opts.status ? undefined : ne(schema.products.status, "archived")) : undefined,
    // Only what's on sale can go unsold, unless another status is asked for.
    opts.unsold && PRODUCT_UNSOLD.includes(opts.unsold) ? and(unsoldWhere(opts.unsold), opts.status ? undefined : eq(schema.products.status, "active")) : undefined,
    q
      ? or(
          sql`lower(${schema.products.title}) like ${`%${q}%`}`,
          inArray(schema.products.id, db.select({ id: schema.variants.productId }).from(schema.variants).where(sql`lower(${schema.variants.sku}) = ${q}`)),
        )
      : undefined,
  );
}

const QUERY_STATUSES = ["active", "draft", "archived"] as const;

/** Reads the list's search and filters from a link or form, dropping anything unknown. */
export function parseProductQuery(get: (key: string) => string | null | undefined): ProductQuery {
  return {
    query: get("q")?.trim() || undefined,
    status: QUERY_STATUSES.find((s) => s === get("status")),
    tag: get("tag")?.trim().toLowerCase().slice(0, 30) || undefined,
    stock: PRODUCT_STOCK_FILTERS.find((s) => s === get("stock")),
    source: PRODUCT_SOURCES.find((s) => s === get("source")),
    collection: UUID.test(get("collection") ?? "") ? get("collection")! : undefined,
    missing: PRODUCT_GAPS.find((g) => g === get("missing")),
    margin: PRODUCT_MARGINS.find((m) => m === get("margin")),
    unsold: PRODUCT_UNSOLD.find((d) => d === get("unsold")),
  };
}

/** Ids of the products a list shows, newest first, up to a limit. */
export async function productIds(db: Db, shopId: string, list: ProductQuery, limit: number) {
  const rows = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(productWhere(db, shopId, list))
    .orderBy(desc(schema.products.createdAt), asc(schema.products.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function productPage(db: Db, shopId: string, opts: ProductQuery & { sort?: ProductSort; page?: number; size?: number } = {}) {
  await publishDueProducts(db, shopId);
  const size = opts.size ?? PRODUCT_PAGE_SIZE;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const where = productWhere(db, shopId, opts);
  const [rows, [count]] = await Promise.all([
    db.select().from(schema.products).where(where).orderBy(...productOrder(opts.sort ?? "newest"), asc(schema.products.id)).limit(size).offset((page - 1) * size),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.products).where(where),
  ]);
  const vs = rows.length
    ? await db.select().from(schema.variants).where(inArray(schema.variants.productId, rows.map((p) => p.id))).orderBy(asc(schema.variants.position))
    : [];
  const byProduct = groupBy(vs, (v) => v.productId);
  return { products: rows.map((p) => ({ ...p, variants: byProduct.get(p.id) ?? [] })), total: count!.n };
}

/** Every tag the store's products use, most used first, to filter the product list. */
export async function productTags(db: Db, shopId: string) {
  const rows = await db
    .select({ tag: sql<string>`t.tag`, n: sql<number>`count(*)::int` })
    .from(sql`${schema.products}, jsonb_array_elements_text(${schema.products.tags}) as t(tag)`)
    .where(eq(schema.products.shopId, shopId))
    .groupBy(sql`t.tag`)
    .orderBy(sql`count(*) desc`, sql`t.tag`)
    .limit(100);
  return rows.map((r) => ({ tag: r.tag, count: r.n }));
}

export async function getProduct(db: Db, shopId: string, productId: string) {
  const product = await db.query.products.findFirst({
    where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)),
  });
  if (!product) throw new NotFoundError("Product");
  const vs = await db.query.variants.findMany({
    where: eq(schema.variants.productId, productId),
    orderBy: asc(schema.variants.position),
  });
  return { ...product, variants: vs };
}

/** Storefront: only active products are visible to buyers. */
export async function listActiveProducts(db: Db, shopId: string) {
  await publishDueProducts(db, shopId);
  return productsWithVariants(db, and(eq(schema.products.shopId, shopId), eq(schema.products.status, "active")));
}

export async function getActiveProductByHandle(db: Db, shopId: string, handle: string) {
  const product = await db.query.products.findFirst({
    where: and(
      eq(schema.products.shopId, shopId),
      eq(schema.products.handle, handle),
      eq(schema.products.status, "active"),
    ),
  });
  if (!product) throw new NotFoundError("Product");
  const vs = await db.query.variants.findMany({
    where: eq(schema.variants.productId, product.id),
    orderBy: asc(schema.variants.position),
  });
  return { ...product, variants: vs };
}

const patchInput = z.object({
  status: z.enum(["draft", "active", "archived"]).optional(),
  variants: z
    .array(
      z.object({
        id: z.string().uuid(),
        priceMinor: z.number().int().min(0, "Price can't be negative.").optional(),
        stock: z.number().int().min(0, "Stock can't be negative.").nullish(),
      }),
    )
    .optional(),
});

/** Quick edits from the phone: status, and price or stock per variant. Everything else stays. */
export async function patchProduct(db: Db, shopId: string, productId: string, input: z.input<typeof patchInput>) {
  const parsed = patchInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { status, variants } = parsed.data;
  const current = await getProduct(db, shopId, productId);
  if (status === "active" && current.variants.every((v) => v.priceMinor === 0)) throw new UserError("Set a price before making it active.");
  await db.transaction(async (tx) => {
    await tx.update(schema.products).set({ ...(status ? { status } : {}), ...(status && status !== "draft" ? { publishAt: null } : {}), updatedAt: new Date() }).where(eq(schema.products.id, productId));
    for (const v of variants ?? []) {
      if (!current.variants.some((c) => c.id === v.id)) throw new NotFoundError("Variant");
      const set = { ...(v.priceMinor !== undefined ? { priceMinor: v.priceMinor } : {}), ...(v.stock !== undefined ? { stock: v.stock } : {}) };
      if (Object.keys(set).length) await tx.update(schema.variants).set(set).where(eq(schema.variants.id, v.id));
    }
    await recordStockEdits(tx as unknown as Db, productId, new Map(current.variants.map((c) => [c.id, c.stock])));
  });
  return getProduct(db, shopId, productId);
}

/** A photo the merchant uploaded from the app becomes the cover; the address is our own media route. */
export async function setProductImage(db: Db, shopId: string, productId: string, imageUrl: string) {
  await editProductPhotos(db, shopId, productId, { kind: "add", url: imageUrl, cover: true });
  return (await db.query.products.findFirst({ where: eq(schema.products.id, productId) }))!;
}

export type OptionDef = { name: string; values: string[] };

/**
 * Every combination of a product's options, in order: Color (Black, White) and Size (S, M) give
 * "Black / S", "Black / M", "White / S", "White / M".
 */
export function combineOptions(defs: OptionDef[]) {
  const clean = defs
    .map((d) => ({ name: d.name.trim(), values: [...new Set(d.values.map((v) => v.trim()).filter(Boolean))] }))
    .filter((d) => d.name && d.values.length);
  if (clean.length > MAX_OPTIONS) throw new UserError(`Use up to ${MAX_OPTIONS} options, like size, colour and material.`);
  const names = clean.map((d) => d.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new UserError("Give each option a different name.");
  let combos: Record<string, string>[] = [{}];
  for (const d of clean) combos = combos.flatMap((c) => d.values.map((v) => ({ ...c, [d.name]: v })));
  if (combos.length > MAX_VARIANTS) throw new UserError(`That makes ${combos.length} combinations; a product can have up to ${MAX_VARIANTS}.`);
  return clean.length ? combos.map((options) => ({ title: Object.values(options).join(" / "), options })) : [];
}

/**
 * A product's options and their values, in the order its variants use them. The database doesn't
 * keep the order of option names, so it's read from a title like "Red / L" when it matches.
 */
export function optionDefsOf(variants: { title?: string; options: Record<string, string> | null }[]): OptionDef[] {
  const defs: OptionDef[] = [];
  for (const v of variants) {
    const entries = Object.entries(v.options ?? {});
    const parts = v.title?.split(" / ") ?? [];
    if (parts.length === entries.length) {
      const at = (value: string) => parts.indexOf(value);
      if (entries.every(([, value]) => at(value) >= 0)) entries.sort((a, b) => at(a[1]) - at(b[1]));
    }
    for (const [name, value] of entries) {
      let d = defs.find((x) => x.name === name);
      if (!d) defs.push((d = { name, values: [] }));
      if (!d.values.includes(value)) d.values.push(value);
    }
  }
  return defs;
}
