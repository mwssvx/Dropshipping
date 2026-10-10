import { and, avg, count, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";
import { saveMedia } from "./mobile/media";

/** Buyers can add a few photos to a review. Kept small so a review with photos fits one upload. */
export const MAX_REVIEW_PHOTOS = 3;
export const MAX_REVIEW_PHOTO_BYTES = 3 * 1024 * 1024;

/** Where a review photo is served, on any of the store's addresses. */
export const reviewPhotoUrl = (id: string) => `/api/media/${id}`;

const REVIEWABLE = ["partially_shipped", "shipped", "delivered"] as const;

async function orderByRef(db: Db, shopId: string, paymentIntentId: string) {
  const order = await db.query.orders.findFirst({ where: and(eq(schema.orders.shopId, shopId), eq(schema.orders.paymentIntentId, paymentIntentId)) });
  if (!order) throw new NotFoundError("Order");
  return order;
}

/** The products on an order the buyer can review (once it has shipped), with any review already left. */
export async function reviewableItems(db: Db, shopId: string, paymentIntentId: string) {
  const order = await orderByRef(db, shopId, paymentIntentId);
  // A replacement is reviewed on the order it replaces, once.
  if (order.source === "replacement" || !REVIEWABLE.includes(order.fulfillmentStatus as (typeof REVIEWABLE)[number])) return [];
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

export async function submitReview(
  db: Db,
  shop: { id: string; reviewsAutoPublish: boolean },
  paymentIntentId: string,
  input: z.input<typeof reviewInput>,
  photos: Buffer[] = [],
) {
  const parsed = reviewInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const files = photos.filter((p) => p.length > 0);
  if (files.length > MAX_REVIEW_PHOTOS) throw new UserError(`Add up to ${MAX_REVIEW_PHOTOS} photos.`);
  if (files.some((p) => p.length > MAX_REVIEW_PHOTO_BYTES)) throw new UserError("Each photo can be up to 3 MB.");
  const items = await reviewableItems(db, shop.id, paymentIntentId);
  const item = items.find((i) => i.productId === parsed.data.productId);
  if (!item) throw new UserError("You can review this once your order has shipped.");
  if (item.review) throw new UserError("You've already reviewed this. Thank you!");
  const order = await orderByRef(db, shop.id, paymentIntentId);
  // Photos are checked (real JPG, PNG or WebP) and stored before the review, and removed again if
  // the review doesn't go in.
  const photoIds: string[] = [];
  try {
    for (const file of files) photoIds.push((await saveMedia(db, shop.id, file)).id);
  } catch (e) {
    await deleteMedia(db, photoIds);
    throw e;
  }
  const [row] = await db
    .insert(schema.reviews)
    .values({ ...parsed.data, photoIds, shopId: shop.id, orderId: order.id, status: shop.reviewsAutoPublish ? "published" : "pending" })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    await deleteMedia(db, photoIds);
    throw new UserError("You've already reviewed this. Thank you!");
  }
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

export async function moderateReview(
  db: Db,
  shopId: string,
  reviewId: string,
  input: { status?: "published" | "hidden"; reply?: string | null; removePhotoId?: string },
) {
  const reply = input.reply === undefined ? undefined : input.reply?.trim().slice(0, 1000) || null;
  const current = await db.query.reviews.findFirst({ where: and(eq(schema.reviews.id, reviewId), eq(schema.reviews.shopId, shopId)) });
  if (!current) throw new NotFoundError("Review");
  // A photo the merchant takes down is deleted, not just hidden.
  const removed = input.removePhotoId && current.photoIds.includes(input.removePhotoId) ? input.removePhotoId : null;
  const changes = {
    ...(input.status ? { status: input.status } : {}),
    ...(reply !== undefined ? { reply } : {}),
    ...(removed ? { photoIds: current.photoIds.filter((p) => p !== removed) } : {}),
  };
  if (!Object.keys(changes).length) return current;
  const [row] = await db.update(schema.reviews).set(changes).where(eq(schema.reviews.id, current.id)).returning();
  if (removed) await deleteMedia(db, [removed]);
  return row;
}

async function deleteMedia(db: Db, ids: string[]) {
  if (ids.length) await db.delete(schema.media).where(inArray(schema.media.id, ids));
}

/** Deletes the photos on these reviews, e.g. when a buyer's data is erased. */
export async function removeReviewPhotos(db: Db, reviewIds: string[]) {
  if (!reviewIds.length) return;
  const rows = await db.query.reviews.findMany({ where: inArray(schema.reviews.id, reviewIds), columns: { photoIds: true } });
  await db.update(schema.reviews).set({ photoIds: [] }).where(inArray(schema.reviews.id, reviewIds));
  await deleteMedia(db, rows.flatMap((r) => r.photoIds));
}

/** Published reviews for a product page, with the average for the stars and search results. */
export async function productReviews(db: Db, productId: string, limit = 20) {
  const where = and(eq(schema.reviews.productId, productId), eq(schema.reviews.status, "published"));
  const [[stats], reviews] = await Promise.all([
    db.select({ n: count(), avg: avg(schema.reviews.rating) }).from(schema.reviews).where(where),
    db.query.reviews.findMany({ where, orderBy: desc(schema.reviews.createdAt), limit }),
  ]);
  const n = Number(stats?.n ?? 0);
  // The newest buyer photos for the strip above the reviews, from any published review.
  const withPhotos = await db.query.reviews.findMany({
    where: and(where, sql`jsonb_array_length(${schema.reviews.photoIds}) > 0`),
    orderBy: desc(schema.reviews.createdAt),
    columns: { id: true, name: true, rating: true, photoIds: true },
    limit: 12,
  });
  const photos = withPhotos.flatMap((r) => r.photoIds.map((id) => ({ url: reviewPhotoUrl(id), reviewId: r.id, name: r.name, rating: r.rating }))).slice(0, 12);
  return { count: n, average: n ? Math.round(Number(stats?.avg) * 10) / 10 : null, reviews, photos };
}

export async function countPendingReviews(db: Db, shopId: string) {
  const [row] = await db.select({ n: count() }).from(schema.reviews).where(and(eq(schema.reviews.shopId, shopId), eq(schema.reviews.status, "pending")));
  return Number(row?.n ?? 0);
}
