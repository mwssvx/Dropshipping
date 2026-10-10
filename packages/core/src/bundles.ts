// Bundles: two to four products sold together for less ("Desk set: lamp + organiser, save 15%").
// A buyer who has one of each in their cart gets the percentage off those items, once per full
// set. Bundles and discount codes don't combine: the cart uses whichever saves the buyer more.
// Wholesale buyers already get their own prices, and gift cards are never part of a bundle.
import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { salePrice, salesFor } from "./sales";

export const MAX_BUNDLES = 50;
export const MAX_BUNDLE_PERCENT = 50;

type Bundle = typeof schema.bundles.$inferSelect;

const bundleInput = z.object({
  title: z.string().trim().min(1, "Give the bundle a name.").max(80, "Keep the name under 80 characters."),
  productIds: z
    .array(z.string().uuid("Pick products from your store."))
    .min(2, "Pick at least two products.")
    .max(4, "A bundle has up to four products.")
    .refine((ids) => new Set(ids).size === ids.length, "Pick each product once."),
  percentOff: z.coerce
    .number({ invalid_type_error: "Enter the discount as a number." })
    .int("Use a whole number for the discount.")
    .min(1, "Enter a discount of at least 1%.")
    .max(MAX_BUNDLE_PERCENT, `Bundles save up to ${MAX_BUNDLE_PERCENT}%.`),
  active: z.boolean().default(true),
});
export type BundleInput = z.input<typeof bundleInput>;

async function checkProducts(db: Db, shopId: string, ids: string[]) {
  const rows = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids)),
    columns: { id: true, giftCard: true, status: true },
  });
  if (rows.length !== ids.length) throw new UserError("Pick products from your store.");
  if (rows.some((r) => r.giftCard)) throw new UserError("Gift cards can't be part of a bundle.");
  if (rows.some((r) => r.status === "archived")) throw new UserError("One of those products is archived. Pick products you still sell.");
}

function parse(input: BundleInput) {
  const parsed = bundleInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  return parsed.data;
}

export async function createBundle(db: Db, shopId: string, input: BundleInput) {
  const data = parse(input);
  const [{ n }] = (await db.select({ n: count() }).from(schema.bundles).where(eq(schema.bundles.shopId, shopId))) as [{ n: number }];
  if (n >= MAX_BUNDLES) throw new UserError(`A store can have up to ${MAX_BUNDLES} bundles. Delete one you no longer use first.`);
  await checkProducts(db, shopId, data.productIds);
  const [row] = await db.insert(schema.bundles).values({ shopId, ...data }).returning();
  return row!;
}

export async function updateBundle(db: Db, shopId: string, bundleId: string, input: BundleInput) {
  const data = parse(input);
  await checkProducts(db, shopId, data.productIds);
  const [row] = await db
    .update(schema.bundles)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.bundles.id, bundleId), eq(schema.bundles.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Bundle");
  return row;
}

/** Turns a bundle on or off on the store, keeping it. */
export async function setBundleActive(db: Db, shopId: string, bundleId: string, active: boolean) {
  const [row] = await db
    .update(schema.bundles)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(schema.bundles.id, bundleId), eq(schema.bundles.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Bundle");
  return row;
}

export async function deleteBundle(db: Db, shopId: string, bundleId: string) {
  const [row] = await db.delete(schema.bundles).where(and(eq(schema.bundles.id, bundleId), eq(schema.bundles.shopId, shopId))).returning({ id: schema.bundles.id });
  if (!row) throw new NotFoundError("Bundle");
}

export async function getBundle(db: Db, shopId: string, bundleId: string) {
  const row = await db.query.bundles.findFirst({ where: and(eq(schema.bundles.id, bundleId), eq(schema.bundles.shopId, shopId)) });
  if (!row) throw new NotFoundError("Bundle");
  return row;
}

/** Every bundle with its products' titles, for the admin list. */
export async function listBundles(db: Db, shopId: string) {
  const bundles = await db.query.bundles.findMany({ where: eq(schema.bundles.shopId, shopId), orderBy: asc(schema.bundles.createdAt) });
  const ids = [...new Set(bundles.flatMap((b) => b.productIds))];
  const products = ids.length
    ? await db.query.products.findMany({ where: inArray(schema.products.id, ids), columns: { id: true, title: true, status: true } })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  return bundles.map((b) => {
    const items = b.productIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    // A bundle shows on the store only while all of its products are on sale.
    const live = b.active && items.length === b.productIds.length && items.every((p) => p.status === "active");
    return { ...b, products: items, live };
  });
}

/** Products a bundle can include: anything not archived, except gift cards. */
export async function bundleProductChoices(db: Db, shopId: string) {
  return db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), ne(schema.products.status, "archived"), eq(schema.products.giftCard, false)),
    columns: { id: true, title: true },
    orderBy: asc(schema.products.title),
  });
}

export type BundleProduct = {
  id: string;
  handle: string;
  title: string;
  imageUrl: string | null;
  variants: { id: string; title: string; priceMinor: number; available: boolean }[];
};

/**
 * Live bundles that include a product, for its store page: each with its products (this one
 * first) and their options. Bundles with a product that's not on sale, or sold out in every
 * option, are left out.
 */
export async function bundlesForProduct(db: Db, shopId: string, productId: string) {
  const all = await db.query.bundles.findMany({ where: and(eq(schema.bundles.shopId, shopId), eq(schema.bundles.active, true)), orderBy: asc(schema.bundles.createdAt) });
  const mine = all.filter((b) => b.productIds.includes(productId));
  if (!mine.length) return [];
  const ids = [...new Set(mine.flatMap((b) => b.productIds))];
  const [products, variants, sales] = await Promise.all([
    db.query.products.findMany({
      where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, ids), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)),
      columns: { id: true, handle: true, title: true, imageUrl: true },
    }),
    db.query.variants.findMany({ where: inArray(schema.variants.productId, ids), orderBy: asc(schema.variants.position) }),
    salesFor(db, shopId, ids),
  ]);
  const byId = new Map<string, BundleProduct>(
    products.map((p) => [
      p.id,
      {
        ...p,
        variants: variants
          .filter((v) => v.productId === p.id)
          .map((v) => ({ id: v.id, title: v.title, priceMinor: salePrice(v.priceMinor, null, sales.get(p.id)).priceMinor, available: v.stock === null || v.stock > 0 })),
      },
    ]),
  );
  return mine.flatMap((b) => {
    const order = [productId, ...b.productIds.filter((id) => id !== productId)];
    const items = order.map((id) => byId.get(id));
    if (items.some((p) => !p || !p.variants.some((v) => v.available))) return [];
    const list = items as BundleProduct[];
    // Priced with each product's cheapest option that's in stock.
    const fullMinor = list.reduce((s, p) => s + Math.min(...p.variants.filter((v) => v.available).map((v) => v.priceMinor)), 0);
    return [{ id: b.id, title: b.title, percentOff: b.percentOff, products: list, fullMinor, bundleMinor: fullMinor - Math.round((fullMinor * b.percentOff) / 100) }];
  });
}

export type BundleSaving = { bundleId: string; title: string; percentOff: number; sets: number; savingMinor: number };

/**
 * What bundles save on a cart. Each unit counts towards one bundle at most: bigger percentages
 * go first, and the cheapest units of a product are the ones bundled, so the saving is never
 * more than the merchant meant. Pure, so the cart and tests share it.
 */
export function bundleSavings(bundles: Pick<Bundle, "id" | "title" | "productIds" | "percentOff">[], items: { productId: string; unitPriceMinor: number; quantity: number }[]) {
  // Units left per product, cheapest first.
  const units = new Map<string, number[]>();
  for (const i of items) {
    const list = units.get(i.productId) ?? [];
    for (let n = 0; n < i.quantity; n++) list.push(i.unitPriceMinor);
    units.set(i.productId, list);
  }
  for (const list of units.values()) list.sort((a, b) => a - b);
  const out: BundleSaving[] = [];
  for (const b of [...bundles].sort((x, y) => y.percentOff - x.percentOff)) {
    const sets = Math.min(...b.productIds.map((id) => units.get(id)?.length ?? 0));
    if (!sets) continue;
    let bundled = 0;
    for (const id of b.productIds) bundled += units.get(id)!.splice(0, sets).reduce((s, u) => s + u, 0);
    out.push({ bundleId: b.id, title: b.title, percentOff: b.percentOff, sets, savingMinor: Math.round((bundled * b.percentOff) / 100) });
  }
  return out;
}

/** Active bundles of a store whose products are all in the cart. */
export async function bundlesInCart(db: Db, shopId: string, productIds: string[]) {
  if (productIds.length < 2) return [];
  const all = await db.query.bundles.findMany({ where: and(eq(schema.bundles.shopId, shopId), eq(schema.bundles.active, true)) });
  const have = new Set(productIds);
  return all.filter((b) => b.productIds.every((id) => have.has(id)));
}

/**
 * The options a buyer picked for each product of a bundle, checked: one option in stock of each.
 * A product with no pick gets its first option in stock.
 */
export async function pickBundleVariants(db: Db, shopId: string, bundleId: string, picked: Record<string, string>) {
  const b = await db.query.bundles.findFirst({ where: and(eq(schema.bundles.id, bundleId), eq(schema.bundles.shopId, shopId), eq(schema.bundles.active, true)) });
  if (!b) throw new NotFoundError("Bundle");
  const rows = await db
    .select({ id: schema.variants.id, productId: schema.variants.productId, stock: schema.variants.stock })
    .from(schema.variants)
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(and(inArray(schema.variants.productId, b.productIds), eq(schema.products.shopId, shopId), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)))
    .orderBy(asc(schema.variants.position));
  return b.productIds.map((productId) => {
    const options = rows.filter((r) => r.productId === productId && (r.stock === null || r.stock > 0));
    const v = options.find((o) => o.id === picked[productId]) ?? options[0];
    if (!v) throw new UserError("Part of this bundle is sold out.", "unavailable");
    return v.id;
  });
}
