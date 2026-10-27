import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { MAX_WEIGHT_GRAMS } from "./weight";
import { recordStockEdits } from "./own-stock";
import { uniqueHandle } from "./handles";
import { editProductPhotos, inheritedPhoto, photoColumns } from "./gallery";
import { publishDueProducts } from "./publish-later";

export const MAX_VARIANTS = 100;
export const MAX_OPTIONS = 3;

const variantInput = z.object({
  /** An existing option of this product, to edit it in place; leave out to add one. */
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).default("Default"),
  priceMinor: z.number().int().min(0, "Price can't be negative."),
  compareAtMinor: z.number().int().min(0).nullish(),
  costMinor: z.number().int().min(0).nullish(),
  sku: z.string().trim().nullish(),
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
});

export type ProductInput = z.input<typeof productInput>;

function parse(input: ProductInput) {
  const parsed = productInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  return parsed.data;
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
        .values({ ...v, productId: copy!.id, stock: original.supplierId || v.stock === null ? v.stock : 0 })
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
    await recordStockEdits(tx as unknown as Db, productId, new Map(existing.map((e) => [e.id, e.stock])));
    return product;
  });
}

export async function listProducts(db: Db, shopId: string) {
  // The admin, the app and the API all list from here, so scheduled drafts show as on sale on time.
  await publishDueProducts(db, shopId);
  const rows = await db.query.products.findMany({
    where: eq(schema.products.shopId, shopId),
    orderBy: desc(schema.products.createdAt),
    with: undefined,
  });
  const vs = rows.length
    ? await db.query.variants.findMany({
        where: inArray(schema.variants.productId, rows.map((r) => r.id)),
        orderBy: asc(schema.variants.position),
      })
    : [];
  return rows.map((p) => ({ ...p, variants: vs.filter((v) => v.productId === p.id) }));
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
  return (await listProducts(db, shopId)).filter((p) => p.status === "active");
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
