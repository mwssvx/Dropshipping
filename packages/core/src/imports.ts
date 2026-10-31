import { and, eq } from "drizzle-orm";
import { schema, type Db, type PricingRule } from "@sf/db";
import { z } from "zod";
import { UserError } from "./errors";
import { supplierPhotos } from "./gallery";
import { uniqueHandle } from "./handles";
import { compareAtFor, DEFAULT_PRICING_RULE, priceFromCost, pricingRuleOf } from "./pricing";
import { SupplierError, type SupplierAdapter, type SupplierProduct, type Suppliers } from "./suppliers";
import { fromWarehouse, warehousesOf, type Warehouse } from "./warehouses";

/** Starting retail price from the store's pricing rule. The merchant can change it before import. */
export function suggestPrice(costMinor: number, rule: PricingRule = DEFAULT_PRICING_RULE): number {
  return priceFromCost(costMinor, rule);
}

async function shopFor(db: Db, shopId: string) {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { pricingRule: true, country: true } });
  return { rule: shop ? pricingRuleOf(shop) : DEFAULT_PRICING_RULE, country: shop?.country ?? "US" };
}

export type ImportPreview = {
  supplier: { name: SupplierAdapter["name"]; label: string };
  product: SupplierProduct;
  suggestedPrices: Record<string, number>;
  alreadyImported: { id: string; title: string } | null;
  /** The warehouses the listing ships from, when it has a "Ships From" option, and the one shown. */
  warehouses: Warehouse[];
  warehouse: string | null;
  /** The warehouse's country when it isn't the store's own. */
  shipsFrom: string | null;
};

async function fetchProduct(suppliers: Suppliers, url: string) {
  try {
    const supplier = suppliers.forUrl(url);
    return { supplier, product: await supplier.getProductFromUrl(url.trim()) };
  } catch (e) {
    if (e instanceof SupplierError) throw new UserError(e.message, e.code);
    throw e;
  }
}

async function findExisting(db: Db, shopId: string, ref: string) {
  return (
    (await db.query.products.findFirst({
      where: and(eq(schema.products.shopId, shopId), eq(schema.products.supplierProductRef, ref)),
      columns: { id: true, title: true },
    })) ?? null
  );
}

/** The listing from the picked warehouse (or the default one), and where it ships from. */
function sellFrom(listing: SupplierProduct, storeCountry: string, chosen?: string | null) {
  const picked = fromWarehouse(listing, storeCountry, chosen);
  return { ...picked, shipsFrom: picked.shipsFrom === storeCountry ? null : picked.shipsFrom };
}

export async function previewImport(db: Db, suppliers: Suppliers, shopId: string, url: string, warehouse?: string | null): Promise<ImportPreview> {
  const { supplier, product: listing } = await fetchProduct(suppliers, url);
  const { rule, country } = await shopFor(db, shopId);
  const { product, warehouse: picked, shipsFrom } = sellFrom(listing, country, warehouse);
  return {
    supplier: { name: supplier.name, label: supplier.label },
    product,
    suggestedPrices: Object.fromEntries(product.variants.map((v) => [v.ref, suggestPrice(v.costMinor, rule)])),
    alreadyImported: await findExisting(db, shopId, product.ref),
    warehouses: warehousesOf(listing),
    warehouse: picked,
    shipsFrom,
  };
}

const importInput = z.object({
  url: z.string().trim().min(1),
  title: z.string().trim().min(1, "Give the product a title.").max(200),
  description: z.string().max(50_000).optional(),
  prices: z.record(z.string(), z.number().int().min(0, "Price can't be negative.")),
  publish: z.boolean().default(false),
  /** Which warehouse to sell from, for listings with a "Ships From" option. */
  warehouse: z.string().max(100).nullable().optional(),
});

/**
 * Create a product from a supplier listing. Costs, stock and supplier ids are re-read from the
 * supplier here, never taken from the form, so the margin shown later is the real one.
 */
export async function importProduct(db: Db, suppliers: Suppliers, shopId: string, input: z.input<typeof importInput>) {
  const parsed = importInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const data = parsed.data;
  const { supplier, product: listing } = await fetchProduct(suppliers, data.url);
  const existing = await findExisting(db, shopId, listing.ref);
  if (existing) throw new UserError(`You've already imported this product as "${existing.title}".`, "duplicate");

  const { rule, country } = await shopFor(db, shopId);
  const { product, shipsFrom } = sellFrom(listing, country, data.warehouse);
  const photos = supplierPhotos(product.images, product.variants.map((v) => v.imageUrl));
  const variants = product.variants.map((v, i) => {
    const price = data.prices[v.ref] ?? suggestPrice(v.costMinor, rule);
    return {
      title: v.title,
      options: v.options ?? {},
      supplierVariantRef: v.ref,
      priceMinor: price,
      compareAtMinor: compareAtFor(price, rule),
      costMinor: v.costMinor,
      stock: v.stock,
      shipDaysMin: v.shipDaysMin,
      shipDaysMax: v.shipDaysMax,
      position: i,
      imageUrl: photos.variantImage(v.imageUrl),
    };
  });
  if (data.publish && variants.some((v) => v.priceMinor <= (v.costMinor ?? 0))) {
    throw new UserError("A price is at or below the supplier cost. Raise it or save as a draft.", "below_cost");
  }

  const handle = await uniqueHandle(data.title, async (h) =>
    !!(await db.query.products.findFirst({
      where: and(eq(schema.products.shopId, shopId), eq(schema.products.handle, h)),
      columns: { id: true },
    })),
  );

  return db.transaction(async (tx) => {
    const [link] = await tx
      .insert(schema.suppliers)
      .values({ shopId, provider: supplier.name })
      .onConflictDoUpdate({ target: [schema.suppliers.shopId, schema.suppliers.provider, schema.suppliers.contactEmail], set: { status: "connected" } })
      .returning({ id: schema.suppliers.id });
    const [created] = await tx
      .insert(schema.products)
      .values({
        shopId,
        title: data.title,
        handle,
        descriptionHtml: data.description ?? product.description,
        images: photos.images,
        imageUrl: photos.imageUrl,
        status: data.publish ? "active" : "draft",
        supplierId: link!.id,
        supplierProductRef: product.ref,
        sourceUrl: product.sourceUrl,
        shipsFrom,
        stockCheckedAt: new Date(),
      })
      .returning();
    await tx.insert(schema.variants).values(variants.map((v) => ({ ...v, productId: created!.id })));
    return created!;
  });
}

export async function getSupplierLink(db: Db, shopId: string, supplierId: string) {
  return db.query.suppliers.findFirst({ where: and(eq(schema.suppliers.id, supplierId), eq(schema.suppliers.shopId, shopId)) });
}

export async function listSupplierLinks(db: Db, shopId: string) {
  return db.query.suppliers.findMany({ where: eq(schema.suppliers.shopId, shopId) });
}
