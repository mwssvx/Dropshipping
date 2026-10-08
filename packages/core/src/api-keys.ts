// Keys for the public REST API (/api/v1), and the shapes it returns. Webhooks send the same shapes.
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, type SQL } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(db: Db, shopId: string, input: { name: string; access: "read" | "write" }, userId?: string) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new UserError("Give the key a name, like the app or person using it.");
  if (input.access !== "read" && input.access !== "write") throw new UserError("Choose read only or read and write.");
  const live = await db.query.apiKeys.findMany({ where: and(eq(schema.apiKeys.shopId, shopId), isNull(schema.apiKeys.revokedAt)) });
  if (live.length >= 20) throw new UserError("A store can have up to 20 keys. Revoke one you no longer use first.");
  const key = `sfk_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(schema.apiKeys)
    .values({ shopId, name, access: input.access, prefix: key.slice(0, 10), hash: hash(key), createdBy: userId ?? null })
    .returning();
  // The only time the full key exists outside the caller's hands.
  return { key, row: row! };
}

export async function listApiKeys(db: Db, shopId: string) {
  return db.query.apiKeys.findMany({ where: eq(schema.apiKeys.shopId, shopId), orderBy: desc(schema.apiKeys.createdAt) });
}

export async function revokeApiKey(db: Db, shopId: string, id: string) {
  const [row] = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.shopId, shopId), isNull(schema.apiKeys.revokedAt)))
    .returning();
  if (!row) throw new NotFoundError("API key");
  return row;
}

/** The store and key for a bearer key, or null. Marks it used at most once a minute. */
export async function authenticateApiKey(db: Db, key: string, now = new Date()) {
  if (!/^sfk_[A-Za-z0-9_-]{20,64}$/.test(key)) return null;
  const row = await db.query.apiKeys.findFirst({ where: and(eq(schema.apiKeys.hash, hash(key)), isNull(schema.apiKeys.revokedAt)) });
  if (!row) return null;
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, row.shopId) });
  if (!shop) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(schema.apiKeys).set({ lastUsedAt: now }).where(eq(schema.apiKeys.id, row.id));
  }
  return { shop, key: row };
}

/* Public shapes. Field names are snake_case and stable: changing them breaks other people's code. */

type Order = typeof schema.orders.$inferSelect;
type Line = typeof schema.orderLines.$inferSelect;
type Fulfillment = typeof schema.fulfillments.$inferSelect;
type Product = typeof schema.products.$inferSelect;
type Variant = typeof schema.variants.$inferSelect;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function publicOrder(o: Order & { lines?: Line[]; fulfillments?: Fulfillment[] }) {
  return {
    id: o.id,
    number: o.number,
    email: o.email,
    currency: o.currency,
    subtotal: o.subtotalMinor,
    discount: o.discountMinor,
    discount_code: o.discountCode,
    shipping: o.shippingMinor,
    tax: o.taxMinor,
    tax_included: o.taxIncluded,
    total: o.totalMinor,
    refunded: o.refundedMinor,
    payment_status: o.paymentStatus,
    fulfillment_status: o.fulfillmentStatus,
    shipping_address: o.shippingAddress,
    created_at: iso(o.createdAt),
    paid_at: iso(o.paidAt),
    ...(o.lines ? { lines: o.lines.map((l) => ({ variant_id: l.variantId, title: l.title, quantity: l.quantity, unit_price: l.unitPriceMinor })) } : {}),
    ...(o.fulfillments
      ? {
          shipments: o.fulfillments
            .filter((f) => f.trackingNumber)
            .map((f) => ({ carrier: f.carrier, tracking_number: f.trackingNumber, tracking_url: f.trackingUrl, status: f.status, shipped_at: iso(f.shippedAt), delivered_at: iso(f.deliveredAt) })),
        }
      : {}),
  };
}

export function publicProduct(p: Product & { variants: Variant[] }) {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    description_html: p.descriptionHtml,
    image_url: p.imageUrl,
    status: p.status,
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
    variants: p.variants.map((v) => ({ id: v.id, title: v.title, sku: v.sku, price: v.priceMinor, compare_at_price: v.compareAtMinor, stock: v.stock })),
  };
}

/* Pages of orders and products for the API, newest first. */

type OrderFilter = { paymentStatus?: Order["paymentStatus"]; fulfillmentStatus?: Order["fulfillmentStatus"]; since?: Date };

export async function apiListOrders(db: Db, shopId: string, filter: OrderFilter, page: { limit: number; offset: number }) {
  const where: (SQL | undefined)[] = [eq(schema.orders.shopId, shopId)];
  if (filter.paymentStatus) where.push(eq(schema.orders.paymentStatus, filter.paymentStatus));
  if (filter.fulfillmentStatus) where.push(eq(schema.orders.fulfillmentStatus, filter.fulfillmentStatus));
  if (filter.since) where.push(gte(schema.orders.updatedAt, filter.since));
  const rows = await db.query.orders.findMany({ where: and(...where), orderBy: desc(schema.orders.number), limit: page.limit + 1, offset: page.offset });
  return { items: rows.slice(0, page.limit).map((o) => publicOrder(o)), hasMore: rows.length > page.limit };
}

export async function apiListProducts(db: Db, shopId: string, filter: { status?: Product["status"] }, page: { limit: number; offset: number }) {
  const rows = await db.query.products.findMany({
    where: and(eq(schema.products.shopId, shopId), filter.status ? eq(schema.products.status, filter.status) : undefined),
    orderBy: desc(schema.products.createdAt),
    limit: page.limit + 1,
    offset: page.offset,
  });
  const items = rows.slice(0, page.limit);
  const variants = items.length ? await db.query.variants.findMany({ where: inArray(schema.variants.productId, items.map((p) => p.id)), orderBy: asc(schema.variants.position) }) : [];
  return { items: items.map((p) => publicProduct({ ...p, variants: variants.filter((v) => v.productId === p.id) })), hasMore: rows.length > page.limit };
}
