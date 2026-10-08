import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { UserError } from "./errors";
import { uniqueHandle } from "./handles";
import { SupplierError, type SupplierAdapter, type SupplierProduct, type Suppliers } from "./suppliers";

/** Starting retail price: about 2.5x cost, ending in .99. The merchant can change it before import. */
export function suggestPrice(costMinor: number): number {
  return Math.max(99, Math.ceil((costMinor * 2.5) / 100) * 100 - 1);
}

export type ImportPreview = {
  supplier: { name: SupplierAdapter["name"]; label: string };
  product: SupplierProduct;
  suggestedPrices: Record<string, number>;
  alreadyImported: { id: string; title: string } | null;
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

export async function previewImport(db: Db, suppliers: Suppliers, shopId: string, url: string): Promise<ImportPreview> {
  const { supplier, product } = await fetchProduct(suppliers, url);
  return {
    supplier: { name: supplier.name, label: supplier.label },
    product,
    suggestedPrices: Object.fromEntries(product.variants.map((v) => [v.ref, suggestPrice(v.costMinor)])),
    alreadyImported: await findExisting(db, shopId, product.ref),
  };
}

const importInput = z.object({
  url: z.string().trim().min(1),
  title: z.string().trim().min(1, "Give the product a title.").max(200),
  description: z.string().max(50_000).optional(),
  prices: z.record(z.string(), z.number().int().min(0, "Price can't be negative.")),
  publish: z.boolean().default(false),
});

/**
 * Create a product from a supplier listing. Costs, stock and supplier ids are re-read from the
 * supplier here, never taken from the form, so the margin shown later is the real one.
 */
export async function importProduct(db: Db, suppliers: Suppliers, shopId: string, input: z.input<typeof importInput>) {
  const parsed = importInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const data = parsed.data;
  const { supplier, product } = await fetchProduct(suppliers, data.url);
  const existing = await findExisting(db, shopId, product.ref);
  if (existing) throw new UserError(`You've already imported this product as "${existing.title}".`, "duplicate");

  const variants = product.variants.map((v, i) => {
    const price = data.prices[v.ref] ?? suggestPrice(v.costMinor);
    return {
      title: v.title,
      supplierVariantRef: v.ref,
      priceMinor: price,
      costMinor: v.costMinor,
      stock: v.stock,
      shipDaysMin: v.shipDaysMin,
      shipDaysMax: v.shipDaysMax,
      position: i,
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
      .onConflictDoUpdate({ target: [schema.suppliers.shopId, schema.suppliers.provider], set: { status: "connected" } })
      .returning({ id: schema.suppliers.id });
    const [created] = await tx
      .insert(schema.products)
      .values({
        shopId,
        title: data.title,
        handle,
        descriptionHtml: data.description ?? product.description,
        imageUrl: product.images[0] ?? null,
        status: data.publish ? "active" : "draft",
        supplierId: link!.id,
        supplierProductRef: product.ref,
        sourceUrl: product.sourceUrl,
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
