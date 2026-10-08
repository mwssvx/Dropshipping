// Small growth tools: abandoned checkout reminders, "goes well with" suggestions, and their settings.
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { NotFoundError, UserError } from "./errors";
import { sendOrderEmail, type FulfillmentContext } from "./fulfillment";

const HOUR = 3_600_000;

export async function setGrowthSettings(db: Db, shopId: string, input: { abandonedCartEmails?: boolean; reviewsAutoPublish?: boolean }) {
  const set: Partial<typeof schema.shops.$inferInsert> = { updatedAt: new Date() };
  if (input.abandonedCartEmails !== undefined) set.abandonedCartEmails = input.abandonedCartEmails;
  if (input.reviewsAutoPublish !== undefined) set.reviewsAutoPublish = input.reviewsAutoPublish;
  await db.update(schema.shops).set(set).where(eq(schema.shops.id, shopId));
}

/**
 * One reminder for checkouts started 1 to 48 hours ago and never paid, unless the buyer has paid
 * for another order since, or was reminded in the last day about a different checkout.
 */
export async function sendAbandonedCartEmails(ctx: FulfillmentContext, now = new Date()) {
  const { db } = ctx;
  const candidates = await db
    .select({ order: schema.orders })
    .from(schema.orders)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.orders.shopId))
    .where(
      and(
        eq(schema.orders.paymentStatus, "pending"),
        lte(schema.orders.createdAt, new Date(now.getTime() - HOUR)),
        gte(schema.orders.createdAt, new Date(now.getTime() - 48 * HOUR)),
        eq(schema.shops.abandonedCartEmails, true),
        eq(schema.shops.status, "active"),
        sql`not exists (select 1 from ${schema.emails} e where e.order_id = ${schema.orders.id} and e.kind = 'abandoned_cart')`,
      ),
    )
    .limit(500);
  let sent = 0;
  for (const { order } of candidates) {
    const [paidSince] = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.shopId, order.shopId), eq(schema.orders.email, order.email), ne(schema.orders.paymentStatus, "pending"), ne(schema.orders.paymentStatus, "failed"), gte(schema.orders.createdAt, order.createdAt)))
      .limit(1);
    if (paidSince) continue;
    const [recent] = await db
      .select({ id: schema.emails.id })
      .from(schema.emails)
      .where(and(eq(schema.emails.shopId, order.shopId), eq(schema.emails.kind, "abandoned_cart"), eq(schema.emails.to, order.email), gte(schema.emails.createdAt, new Date(now.getTime() - 24 * HOUR))))
      .limit(1);
    if (recent) continue;
    if ((await sendOrderEmail(ctx, order.id, "abandoned_cart")).status === "sent") sent++;
  }
  return { sent };
}

/** Reminders sent since a date, and how many of those checkouts were then paid. */
export async function abandonedCartStats(db: Db, shopId: string, since: Date) {
  const rows = await db
    .select({ paid: schema.orders.paymentStatus, total: schema.orders.totalMinor })
    .from(schema.emails)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.emails.orderId))
    .where(and(eq(schema.emails.shopId, shopId), eq(schema.emails.kind, "abandoned_cart"), gte(schema.emails.createdAt, since)));
  const recovered = rows.filter((r) => ["paid", "partially_refunded", "refunded"].includes(r.paid));
  return { sent: rows.length, recovered: recovered.length, recoveredMinor: recovered.reduce((s, r) => s + r.total, 0) };
}

export async function setUpsell(db: Db, shopId: string, productId: string, upsellProductId: string | null) {
  if (upsellProductId) {
    if (upsellProductId === productId) throw new UserError("Pick a different product to suggest.");
    const other = await db.query.products.findFirst({ where: and(eq(schema.products.id, upsellProductId), eq(schema.products.shopId, shopId)) });
    if (!other) throw new NotFoundError("Product");
  }
  const [row] = await db
    .update(schema.products)
    .set({ upsellProductId, updatedAt: new Date() })
    .where(and(eq(schema.products.id, productId), eq(schema.products.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Product");
  return row;
}

/** Products suggested for these ones, on sale and not already among them, with their first price. */
export async function upsellsFor(db: Db, shopId: string, productIds: string[]) {
  if (!productIds.length) return [];
  const from = await db.query.products.findMany({ where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, productIds)) });
  const ids = [...new Set(from.map((p) => p.upsellProductId).filter((x): x is string => !!x && !productIds.includes(x)))];
  if (!ids.length) return [];
  const products = await db.query.products.findMany({ where: and(inArray(schema.products.id, ids), eq(schema.products.status, "active")) });
  const variants = await db.query.variants.findMany({ where: inArray(schema.variants.productId, products.map((p) => p.id)), orderBy: schema.variants.position });
  return products
    .map((p) => {
      const v = variants.find((x) => x.productId === p.id && (x.stock === null || x.stock > 0));
      return v ? { id: p.id, handle: p.handle, title: p.title, imageUrl: p.imageUrl, variantId: v.id, priceMinor: v.priceMinor } : null;
    })
    .filter((x) => x !== null);
}
