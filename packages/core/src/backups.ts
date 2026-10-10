// Backup suppliers: the same product listed at a second supplier. When the main supplier is out of
// stock or has dropped the listing, the order goes to the backup instead of becoming a problem,
// and the store keeps selling while the backup has stock.
import { and, asc, eq } from "drizzle-orm";
import { schema, type Db, type ProductBackup } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { SupplierError, type SupplierName, type SupplierProduct, type Suppliers } from "./suppliers";

type Variant = typeof schema.variants.$inferSelect;

const optionKey = (options: Record<string, string>) =>
  Object.entries(options)
    .map(([k, v]) => `${k.trim().toLowerCase()}=${v.trim().toLowerCase()}`)
    .sort()
    .join("|");

/**
 * Pairs our variants with the backup's by their options ("Size: Large"), or by title when there
 * are none. A product with one option on each side pairs up whatever they're called.
 */
export function matchBackupVariants(ours: Pick<Variant, "id" | "title" | "options">[], theirs: SupplierProduct["variants"]) {
  const matched = new Map<string, SupplierProduct["variants"][number]>();
  if (ours.length === 1 && theirs.length === 1) {
    matched.set(ours[0]!.id, theirs[0]!);
    return matched;
  }
  for (const v of ours) {
    const key = optionKey(v.options);
    const hit =
      (key && theirs.find((t) => t.options && optionKey(t.options) === key)) ||
      theirs.find((t) => t.title.trim().toLowerCase() === v.title.trim().toLowerCase());
    if (hit) matched.set(v.id, hit);
  }
  return matched;
}

async function findProduct(db: Db, shopId: string, productId: string) {
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new NotFoundError("Product");
  return product;
}

/** Links a second supplier's listing of this product. Costs and stock are read from the supplier. */
export async function setBackupSupplier(db: Db, suppliers: Suppliers, shopId: string, productId: string, url: string) {
  const product = await findProduct(db, shopId, productId);
  if (product.giftCard) throw new UserError("Gift cards don't need a supplier.");
  // The store's stock for these is re-read from the supplier listing, so the backup's can be added on.
  if (!product.supplierId || !product.sourceUrl) throw new UserError("Backups work for products imported from a supplier's listing. This one's stock is yours to set.");
  if (!url.trim()) throw new UserError("Paste the backup supplier's link to the same product.");
  let listing: SupplierProduct;
  let provider: SupplierName;
  try {
    const supplier = suppliers.forUrl(url);
    provider = supplier.name;
    listing = await supplier.getProductFromUrl(url.trim());
  } catch (e) {
    if (e instanceof SupplierError) throw new UserError(e.message, e.code);
    throw e;
  }
  if (listing.ref === product.supplierProductRef) throw new UserError("That's the listing this product already comes from. Paste another supplier's link.");
  const variants = await db.query.variants.findMany({ where: eq(schema.variants.productId, product.id), orderBy: asc(schema.variants.position) });
  const matched = matchBackupVariants(variants, listing.variants);
  if (!matched.size) {
    throw new UserError(`None of that listing's options (${listing.variants.map((v) => v.title).join(", ")}) match this product's (${variants.map((v) => v.title).join(", ")}).`);
  }
  const [link] = await db
    .insert(schema.suppliers)
    .values({ shopId, provider })
    .onConflictDoUpdate({ target: [schema.suppliers.shopId, schema.suppliers.provider, schema.suppliers.contactEmail], set: { status: "connected" } })
    .returning({ id: schema.suppliers.id });
  const backup: ProductBackup = {
    supplierId: link!.id,
    sourceUrl: listing.sourceUrl,
    productRef: listing.ref,
    variants: Object.fromEntries([...matched].map(([id, v]) => [id, { ref: v.ref, costMinor: v.costMinor, stock: v.stock }])),
    checkedAt: new Date().toISOString(),
  };
  await db.update(schema.products).set({ backup, updatedAt: new Date() }).where(eq(schema.products.id, product.id));
  return { backup, unmatched: variants.filter((v) => !matched.has(v.id)).map((v) => v.title) };
}

export async function removeBackupSupplier(db: Db, shopId: string, productId: string) {
  const product = await findProduct(db, shopId, productId);
  await db.update(schema.products).set({ backup: null, updatedAt: new Date() }).where(eq(schema.products.id, product.id));
}

/** Stock the store can sell: the main supplier's plus the backup's. Unlimited on either side wins. */
export function sellableStock(main: number | null, backup: { stock: number | null } | undefined) {
  if (!backup) return main;
  if (main === null || backup.stock === null) return null;
  return Math.max(0, main) + Math.max(0, backup.stock);
}

/**
 * Re-reads the backup listing's stock and cost. A listing that was taken down counts as sold out;
 * a supplier that doesn't answer leaves the last numbers in place.
 */
export async function refreshBackup(suppliers: Suppliers, backup: ProductBackup, at: Date): Promise<ProductBackup> {
  try {
    const listing = await suppliers.forUrl(backup.sourceUrl).getProductFromUrl(backup.sourceUrl);
    const byRef = new Map(listing.variants.map((v) => [v.ref, v]));
    const variants = Object.fromEntries(
      Object.entries(backup.variants).map(([id, v]) => {
        const r = byRef.get(v.ref);
        return [id, r ? { ref: v.ref, costMinor: r.costMinor, stock: r.stock } : { ...v, stock: 0 }];
      }),
    );
    return { ...backup, variants, gone: false, checkedAt: at.toISOString() };
  } catch (e) {
    if (!(e instanceof SupplierError)) throw e;
    if (e.code !== "product_unavailable") return backup;
    return { ...backup, variants: Object.fromEntries(Object.entries(backup.variants).map(([id, v]) => [id, { ...v, stock: 0 }])), gone: true, checkedAt: at.toISOString() };
  }
}
