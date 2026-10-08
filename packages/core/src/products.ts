import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { uniqueHandle } from "./handles";

const variantInput = z.object({
  title: z.string().trim().min(1).default("Default"),
  priceMinor: z.number().int().min(0, "Price can't be negative."),
  compareAtMinor: z.number().int().min(0).nullish(),
  costMinor: z.number().int().min(0).nullish(),
  sku: z.string().trim().nullish(),
  stock: z.number().int().nullish(),
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
  variants: z.array(variantInput).min(1, "Add at least one price."),
});

export type ProductInput = z.input<typeof productInput>;

function parse(input: ProductInput) {
  const parsed = productInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  return parsed.data;
}

export async function createProduct(db: Db, shopId: string, input: ProductInput) {
  const { variants, ...data } = parse(input);
  const handle = await uniqueHandle(data.title, async (h) =>
    !!(await db.query.products.findFirst({
      where: and(eq(schema.products.shopId, shopId), eq(schema.products.handle, h)),
      columns: { id: true },
    })),
  );
  return db.transaction(async (tx) => {
    const [product] = await tx.insert(schema.products).values({ ...data, shopId, handle }).returning();
    await tx.insert(schema.variants).values(variants.map((v, i) => ({ ...v, productId: product!.id, position: i })));
    return product!;
  });
}

export async function updateProduct(db: Db, shopId: string, productId: string, input: ProductInput) {
  const { variants, ...data } = parse(input);
  return db.transaction(async (tx) => {
    const [product] = await tx
      .update(schema.products)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
      .returning();
    if (!product) throw new NotFoundError("Product");
    // M1 keeps one editable variant list; replace in place by position.
    const existing = await tx.query.variants.findMany({
      where: eq(schema.variants.productId, productId),
      orderBy: asc(schema.variants.position),
    });
    for (const [i, v] of variants.entries()) {
      const row = existing[i];
      if (row) await tx.update(schema.variants).set({ ...v, position: i }).where(eq(schema.variants.id, row.id));
      else await tx.insert(schema.variants).values({ ...v, productId, position: i });
    }
    const extra = existing.slice(variants.length).map((v) => v.id);
    if (extra.length) await tx.delete(schema.variants).where(inArray(schema.variants.id, extra));
    return product;
  });
}

export async function listProducts(db: Db, shopId: string) {
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
