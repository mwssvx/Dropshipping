// Samples: before selling something, the merchant orders one from the supplier to their own door,
// to see the quality, the packaging and how long it really takes. It goes to the supplier like an
// order but isn't a sale: no buyer, no payment through us, nothing in sales or profit. The supplier
// charges its own cost and shipping the way it charges for orders (CJ's wallet, AliExpress's card).
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Address, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { SupplierError, type Suppliers } from "./suppliers";

export const SAMPLES_PER_PRODUCT = 3;
const OPEN = ["placed", "shipped"] as const;

type Shop = typeof schema.shops.$inferSelect;

/** Order one of a supplier product's options to the merchant's own address. */
export async function orderSample(db: Db, suppliers: Suppliers, shop: Pick<Shop, "id">, input: { variantId: string; email: string; address: Address }) {
  const variant = await db.query.variants.findFirst({ where: eq(schema.variants.id, input.variantId) });
  const product = variant ? await db.query.products.findFirst({ where: and(eq(schema.products.id, variant.productId), eq(schema.products.shopId, shop.id)) }) : null;
  if (!variant || !product) throw new NotFoundError("Product");
  const link = product.supplierId ? await db.query.suppliers.findFirst({ where: eq(schema.suppliers.id, product.supplierId) }) : null;
  if (!link || link.provider === "email" || !variant.supplierVariantRef) throw new UserError("Samples are for products from a connected supplier. Ask your own supplier for one directly.");
  const a = input.address;
  if (!a.name?.trim() || !a.line1?.trim() || !a.city?.trim() || !a.postalCode?.trim() || !/^[A-Z]{2}$/.test(a.country ?? "")) {
    throw new UserError("Fill in the name, street, city, postal code and country to send the sample to.");
  }
  const sent = await db.query.samples.findMany({ where: and(eq(schema.samples.shopId, shop.id), eq(schema.samples.productId, product.id)), columns: { id: true, status: true } });
  if (sent.filter((s) => s.status !== "failed").length >= SAMPLES_PER_PRODUCT) throw new UserError(`You've ordered ${SAMPLES_PER_PRODUCT} samples of this product already.`);

  const [row] = await db
    .insert(schema.samples)
    .values({ shopId: shop.id, productId: product.id, variantId: variant.id, title: `${product.title}${variant.title === "Default" ? "" : ` (${variant.title})`}`, provider: link.provider, costMinor: variant.costMinor, address: a })
    .returning();
  try {
    const { supplierOrderRef } = await suppliers.get(link.provider).placeOrder({
      reference: `sample_${row!.id}`,
      email: input.email,
      address: { ...a, name: a.name.trim(), line1: a.line1.trim(), city: a.city.trim(), postalCode: a.postalCode.trim() },
      lines: [{ variantRef: variant.supplierVariantRef, quantity: 1 }],
    });
    const [placed] = await db.update(schema.samples).set({ status: "placed", supplierOrderRef, updatedAt: new Date() }).where(eq(schema.samples.id, row!.id)).returning();
    return placed!;
  } catch (e) {
    const message = e instanceof SupplierError ? e.message : "The supplier couldn't be reached. Try again in a few minutes.";
    await db.update(schema.samples).set({ status: "failed", problem: message, updatedAt: new Date() }).where(eq(schema.samples.id, row!.id));
    throw new UserError(`The sample wasn't ordered: ${message}`);
  }
}

/** A product's samples, newest first, after checking the supplier for tracking on open ones. */
export async function listSamples(db: Db, suppliers: Suppliers, shopId: string, productId: string, now = new Date()) {
  const rows = await db.query.samples.findMany({ where: and(eq(schema.samples.shopId, shopId), eq(schema.samples.productId, productId)), orderBy: desc(schema.samples.createdAt) });
  for (const s of rows.filter((r) => (OPEN as readonly string[]).includes(r.status) && r.supplierOrderRef)) {
    try {
      const t = await suppliers.get(s.provider as Parameters<Suppliers["get"]>[0]).getTracking(s.supplierOrderRef!);
      if (!t) continue;
      const status = t.status === "delivered" ? "delivered" : "shipped";
      Object.assign(s, { status, carrier: t.carrier, trackingNumber: t.trackingNumber, trackingUrl: t.url });
      await db
        .update(schema.samples)
        .set({ status, carrier: t.carrier, trackingNumber: t.trackingNumber, trackingUrl: t.url, updatedAt: now })
        .where(and(eq(schema.samples.id, s.id), inArray(schema.samples.status, [...OPEN])));
    } catch {
      // Tracking is checked again next time the page opens.
    }
  }
  return rows;
}
