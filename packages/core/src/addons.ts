// Checkout add-ons: up to three products the merchant offers at checkout for a little less ("Add
// a phone stand for $8.99, save 30%"). The buyer adds one with a tap. The add-on price holds when
// it's bought with something else, comes off the sale price, and isn't for wholesale buyers.
// Gift cards can't be add-ons.
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { salePrice, salesFor } from "./sales";
import { percentOff } from "./wholesale";

export const MAX_ADDONS = 3;
export const MAX_ADDON_PERCENT = 50;

type Shop = typeof schema.shops.$inferSelect;
export type CheckoutAddon = typeof schema.checkoutAddons.$inferSelect;

const addonInput = z.object({
  productId: z.string().uuid("Pick a product from your store."),
  percentOff: z.coerce
    .number({ error: "Enter the discount as a number." })
    .int("Use a whole number for the discount.")
    .min(0, "The discount can't be negative.")
    .max(MAX_ADDON_PERCENT, `Add-ons take up to ${MAX_ADDON_PERCENT}% off.`),
  pitch: z.string().trim().max(120, "Keep the line under 120 characters.").default(""),
});
export type AddonInput = z.input<typeof addonInput>;

export async function createAddon(db: Db, shopId: string, input: AddonInput) {
  const parsed = addonInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const { productId, percentOff: pct, pitch } = parsed.data;
  const product = await db.query.products.findFirst({ where: and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)) });
  if (!product) throw new UserError("Pick a product from your store.");
  if (product.giftCard) throw new UserError("Gift cards can't be add-ons.");
  if (product.status === "archived") throw new UserError("That product is archived. Pick one you still sell.");
  const existing = await db.query.checkoutAddons.findMany({ where: eq(schema.checkoutAddons.shopId, shopId), columns: { productId: true } });
  if (existing.some((a) => a.productId === productId)) throw new UserError("That product is already an add-on.");
  if (existing.length >= MAX_ADDONS) throw new UserError(`A store can offer up to ${MAX_ADDONS} add-ons. Delete one first.`);
  const [row] = await db.insert(schema.checkoutAddons).values({ shopId, productId, percentOff: pct, pitch: pitch || null }).returning();
  return row!;
}

export async function setAddonActive(db: Db, shopId: string, addonId: string, active: boolean) {
  const [row] = await db
    .update(schema.checkoutAddons)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(schema.checkoutAddons.id, addonId), eq(schema.checkoutAddons.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Add-on");
  return row;
}

export async function deleteAddon(db: Db, shopId: string, addonId: string) {
  const [row] = await db
    .delete(schema.checkoutAddons)
    .where(and(eq(schema.checkoutAddons.id, addonId), eq(schema.checkoutAddons.shopId, shopId)))
    .returning({ id: schema.checkoutAddons.id });
  if (!row) throw new NotFoundError("Add-on");
}

/** The add-ons with their products, and how often each was bought on paid orders. */
export async function listAddons(db: Db, shopId: string) {
  const rows = await db
    .select({ addon: schema.checkoutAddons, title: schema.products.title, status: schema.products.status })
    .from(schema.checkoutAddons)
    .innerJoin(schema.products, eq(schema.products.id, schema.checkoutAddons.productId))
    .where(eq(schema.checkoutAddons.shopId, shopId))
    .orderBy(asc(schema.checkoutAddons.createdAt));
  const ids = rows.map((r) => r.addon.id);
  const stats = ids.length
    ? ((await db
        .select({
          addonId: schema.orderLines.addonId,
          bought: sql<number>`count(distinct ${schema.orderLines.orderId})::int`,
          revenue: sql<number>`coalesce(sum(${schema.orderLines.unitPriceMinor} * ${schema.orderLines.quantity}), 0)::int`,
        })
        .from(schema.orderLines)
        .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
        .where(and(inArray(schema.orderLines.addonId, ids), isNotNull(schema.orders.paidAt), ne(schema.orders.paymentStatus, "refunded")))
        .groupBy(schema.orderLines.addonId)) as { addonId: string; bought: number; revenue: number }[])
    : [];
  return rows.map(({ addon, title, status }) => {
    const s = stats.find((x) => x.addonId === addon.id);
    return { ...addon, title, live: addon.active && status === "active", bought: Number(s?.bought ?? 0), revenueMinor: Number(s?.revenue ?? 0) };
  });
}

/** Active add-ons by product, for pricing a cart. */
export async function addonsByProduct(db: Db, shopId: string, productIds: string[]) {
  if (!productIds.length) return new Map<string, CheckoutAddon>();
  const rows = await db.query.checkoutAddons.findMany({
    where: and(eq(schema.checkoutAddons.shopId, shopId), eq(schema.checkoutAddons.active, true), inArray(schema.checkoutAddons.productId, productIds)),
  });
  return new Map(rows.map((r) => [r.productId, r]));
}

/**
 * The add-on to offer at checkout: the first live one that isn't in the cart yet and has an
 * option in stock, priced the way the cart will charge it. Null when there's nothing to offer.
 */
export async function addonOffer(db: Db, shop: Shop, cartProductIds: string[], now = new Date()) {
  const addons = await db.query.checkoutAddons.findMany({
    where: and(eq(schema.checkoutAddons.shopId, shop.id), eq(schema.checkoutAddons.active, true)),
    orderBy: asc(schema.checkoutAddons.createdAt),
  });
  const candidates = addons.filter((a) => !cartProductIds.includes(a.productId));
  if (!candidates.length || !cartProductIds.length) return null;
  const ids = candidates.map((a) => a.productId);
  const [products, variants, sales] = await Promise.all([
    db.query.products.findMany({ where: and(inArray(schema.products.id, ids), eq(schema.products.status, "active"), eq(schema.products.giftCard, false)) }),
    db.query.variants.findMany({ where: inArray(schema.variants.productId, ids), orderBy: asc(schema.variants.position) }),
    salesFor(db, shop.id, ids, now),
  ]);
  for (const addon of candidates) {
    const product = products.find((p) => p.id === addon.productId);
    const options = variants.filter((v) => v.productId === addon.productId && (v.stock === null || v.stock > 0));
    if (!product || !options.length) continue;
    return {
      addon,
      product: { id: product.id, title: product.title, handle: product.handle, imageUrl: product.imageUrl },
      variants: options.map((v) => {
        const listed = salePrice(v.priceMinor, null, sales.get(product.id)).priceMinor;
        return { id: v.id, title: v.title, wasMinor: v.priceMinor, priceMinor: addon.percentOff ? percentOff(listed, addon.percentOff) : listed };
      }),
    };
  }
  return null;
}
export type AddonOffer = NonNullable<Awaited<ReturnType<typeof addonOffer>>>;

/** Checks the buyer's pick from an offer: one of the add-on's options, in stock. */
export async function pickAddonVariant(db: Db, shopId: string, addonId: string, variantId: string) {
  const addon = await db.query.checkoutAddons.findFirst({ where: and(eq(schema.checkoutAddons.id, addonId), eq(schema.checkoutAddons.shopId, shopId), eq(schema.checkoutAddons.active, true)) });
  if (!addon) throw new NotFoundError("Add-on");
  const variant = await db.query.variants.findFirst({ where: and(eq(schema.variants.id, variantId), eq(schema.variants.productId, addon.productId)) });
  if (!variant || (variant.stock !== null && variant.stock <= 0)) throw new UserError("That option just sold out.");
  return variant.id;
}
