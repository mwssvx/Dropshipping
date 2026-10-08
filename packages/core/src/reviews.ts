import { and, avg, count, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";

const REVIEWABLE = ["partially_shipped", "shipped", "delivered"] as const;

async function orderByRef(db: Db, shopId: string, paymentIntentId: string) {
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, shopId), eq(schema.orders.paymentIntentId, paymentIntentId)) });
  if (!order) throw new NotFoundError("Order");
  return order;
}

/** The products on an order the buyer can review (once it has shipped), with any review already left. */
export async function reviewableItems(db: Db, shopId: string, paymentIntentId: string) {
  const order = await orderByRef(db, shopId, paymentIntentId);
  if (!REVIEWABLE.includes(order.fulfillmentStatus as (typeof REVIEWABLE)[number])) return [];
  const lines = await db
    .select({ productId: schema.products.id, title: schema.products.title })
    .from(schema.orderLines)
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(eq(schema.orderLines.orderId, order.id));
  const unique = [...new Map(lines.map((l) => [l.productId, l])).values()];
  const existing = unique.length
    ? await db.query.reviews.findMany({ where: and(eq(schema.reviews.orderId, order.id), inArray(schema.reviews.productId, unique.map((u) => u.productId))) })
    : [];
  return unique.map((u) => ({ ...u, review: existing.find((r) => r.productId === u.productId) ?? null }));
}

const reviewInput = z.object({
  productId: z.string().uuid(),
  rating: z.number().int().min(1, "Pick 1 to 5 stars.").max(5, "Pick 1 to 5 stars."),
  name: z.string().trim().min(1, "Add the name to show with your review.").max(60, "Keep the name under 60 characters."),
  body: z.string().trim().min(10, "Write a little more, at least 10 characters.").max(2000, "Keep it under 2,000 characters."),
});

export async function submitReview(db: Db, shop: { id: string; reviewsAutoPublish: boolean }, paymentIntentId: string, input: z.input<typeof reviewInput>) {
  const parsed = reviewInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const items = await reviewableItems(db, shop.id, paymentIntentId);
  const item = items.find((i) => i.productId === parsed.data.productId);
  if (!item) throw new UserError("You can review this once your order has shipped.");
  if (item.review) throw new UserError("You've already reviewed this. Thank you!");
  const order = await orderByRef(db, shop.id, paymentIntentId);
  const [row] = await db
    .insert(schema.reviews)
    .values({ ...parsed.data, shopId: shop.id, orderId: order.id, status: shop.reviewsAutoPublish ? "published" : "pending" })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new UserError("You've already reviewed this. Thank you!");
  return row;
}

export async function listReviews(db: Db, shopId: string, filter: { status?: "pending" | "published" | "hidden" } = {}) {
  return db
    .select({ review: schema.reviews, productTitle: schema.products.title, orderNumber: schema.orders.number })
    .from(schema.reviews)
    .innerJoin(schema.products, eq(schema.products.id, schema.reviews.productId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.reviews.orderId))
    .where(and(eq(schema.reviews.shopId, shopId), filter.status ? eq(schema.reviews.status, filter.status) : undefined))
    .orderBy(desc(schema.reviews.createdAt))
    .limit(200);
}

export async function moderateReview(db: Db, shopId: string, reviewId: string, input: { status?: "published" | "hidden"; reply?: string | null }) {
  const reply = input.reply === undefined ? undefined : input.reply?.trim().slice(0, 1000) || null;
  const [row] = await db
    .update(schema.reviews)
    .set({ ...(input.status ? { status: input.status } : {}), ...(reply !== undefined ? { reply } : {}) })
    .where(and(eq(schema.reviews.id, reviewId), eq(schema.reviews.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Review");
  return row;
}

/** Published reviews for a product page, with the average for the stars and search results. */
export async function productReviews(db: Db, productId: string, limit = 20) {
  const where = and(eq(schema.reviews.productId, productId), eq(schema.reviews.status, "published"));
  const [[stats], reviews] = await Promise.all([
    db.select({ n: count(), avg: avg(schema.reviews.rating) }).from(schema.reviews).where(where),
    db.query.reviews.findMany({ where, orderBy: desc(schema.reviews.createdAt), limit }),
  ]);
  const n = Number(stats?.n ?? 0);
  return { count: n, average: n ? Math.round(Number(stats?.avg) * 10) / 10 : null, reviews };
}

export async function countPendingReviews(db: Db, shopId: string) {
  const [row] = await db.select({ n: count() }).from(schema.reviews).where(and(eq(schema.reviews.shopId, shopId), eq(schema.reviews.status, "pending")));
  return Number(row?.n ?? 0);
}
