import { and, avg, count, desc, eq, inArray, or, sql } from "drizzle-orm";
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
    // Reviews brought over from another platform have no order.
    .leftJoin(schema.orders, eq(schema.orders.id, schema.reviews.orderId))
    .where(and(eq(schema.reviews.shopId, shopId), filter.status ? eq(schema.reviews.status, filter.status) : undefined))
    .orderBy(desc(schema.reviews.createdAt))
    .limit(200);
}

export const REVIEW_PAGE_SIZE = 50;
export type ReviewStatus = "pending" | "published" | "hidden";

/**
 * One page of the admin review list, newest first: by status, optionally by star rating, and
 * matching a search over the reviewer's name, what they wrote and the product's title. Returns the
 * total so the page can say how many match.
 */
export async function reviewPage(
  db: Db,
  shopId: string,
  opts: { status?: ReviewStatus; rating?: number; query?: string; page?: number; size?: number } = {},
) {
  const size = opts.size ?? REVIEW_PAGE_SIZE;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const r = schema.reviews;
  const q = opts.query?.trim().toLowerCase().slice(0, 100);
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const where = and(
    eq(r.shopId, shopId),
    opts.status ? eq(r.status, opts.status) : undefined,
    opts.rating ? eq(r.rating, opts.rating) : undefined,
    like
      ? or(
          sql`lower(${r.name}) like ${like}`,
          sql`lower(${r.body}) like ${like}`,
          inArray(r.productId, db.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.shopId, shopId), sql`lower(${schema.products.title}) like ${like}`))),
        )
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({ review: r, productTitle: schema.products.title, orderNumber: schema.orders.number })
      .from(r)
      .innerJoin(schema.products, eq(schema.products.id, r.productId))
      .leftJoin(schema.orders, eq(schema.orders.id, r.orderId))
      .where(where)
      .orderBy(desc(r.createdAt), desc(r.id))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: sql<number>`count(*)::int` }).from(r).where(where),
  ]);
  return { reviews: rows, total: total!.n };
}

/** How many reviews each status tab holds. */
export async function reviewCounts(db: Db, shopId: string): Promise<Record<ReviewStatus, number>> {
  const rows = await db
    .select({ status: schema.reviews.status, n: sql<number>`count(*)::int` })
    .from(schema.reviews)
    .where(eq(schema.reviews.shopId, shopId))
    .groupBy(schema.reviews.status);
  const counts = { pending: 0, published: 0, hidden: 0 };
  for (const row of rows) counts[row.status] = row.n;
  return counts;
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

/** Reviews a product page lists at first, and with "Show all". */
export const REVIEWS_SHOWN = 20;
export const REVIEWS_SHOWN_ALL = 100;

/** A star rating from a link, or null when it isn't one of 1 to 5. */
export function starsFilter(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * Published reviews for a product page, with the average for the stars and search results and how
 * many there are of each star rating. `stars` lists only reviews with that rating; the count,
 * average and breakdown always cover them all.
 */
export async function productReviews(db: Db, productId: string, limit = REVIEWS_SHOWN, opts: { stars?: number | null } = {}) {
  const where = and(eq(schema.reviews.productId, productId), eq(schema.reviews.status, "published"));
  const listed = opts.stars ? and(where, eq(schema.reviews.rating, opts.stars)) : where;
  const [byRating, reviews] = await Promise.all([
    db.select({ rating: schema.reviews.rating, n: count() }).from(schema.reviews).where(where).groupBy(schema.reviews.rating),
    db.query.reviews.findMany({ where: listed, orderBy: desc(schema.reviews.createdAt), limit }),
  ]);
  // breakdown[0] is one star, breakdown[4] five.
  const breakdown = [1, 2, 3, 4, 5].map((r) => Number(byRating.find((b) => b.rating === r)?.n ?? 0));
  const n = breakdown.reduce((a, b) => a + b, 0);
  const total = breakdown.reduce((a, b, i) => a + b * (i + 1), 0);
  // The newest buyer photos for the strip above the reviews, from any published review.
  const withPhotos = await db.query.reviews.findMany({
    where: and(where, sql`jsonb_array_length(${schema.reviews.photoIds}) > 0`),
    orderBy: desc(schema.reviews.createdAt),
    columns: { id: true, name: true, rating: true, photoIds: true },
    limit: 12,
  });
  const photos = withPhotos.flatMap((r) => r.photoIds.map((id) => ({ url: reviewPhotoUrl(id), reviewId: r.id, name: r.name, rating: r.rating }))).slice(0, 12);
  const listedCount = opts.stars ? breakdown[opts.stars - 1]! : n;
  return { count: n, average: n ? Math.round((total / n) * 10) / 10 : null, reviews, photos, breakdown, listedCount };
}

/** A product card's stars: the average of its published reviews and how many there are. */
export type CardRating = { average: number; count: number };

/** The stars for each of these products that has published reviews, in one query. */
export async function productRatings(db: Db, shopId: string, productIds: string[]): Promise<Map<string, CardRating>> {
  const result = new Map<string, CardRating>();
  if (!productIds.length) return result;
  const rows = await db
    .select({ productId: schema.reviews.productId, n: count(), avg: avg(schema.reviews.rating) })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.shopId, shopId), eq(schema.reviews.status, "published"), inArray(schema.reviews.productId, [...new Set(productIds)])))
    .groupBy(schema.reviews.productId);
  for (const r of rows) {
    const n = Number(r.n);
    if (n) result.set(r.productId, { average: Math.round(Number(r.avg) * 10) / 10, count: n });
  }
  return result;
}

/** How many recent reviews the home page's reviews section can choose from. */
export const STORE_REVIEWS_SHOWN = 24;

/**
 * The store's published reviews of products still on sale, newest first, with the store-wide
 * average. For the home page's reviews section, which picks from them by rating.
 */
export async function storeReviews(db: Db, shopId: string, limit = STORE_REVIEWS_SHOWN) {
  const where = and(eq(schema.reviews.shopId, shopId), eq(schema.reviews.status, "published"), eq(schema.products.status, "active"));
  const [[stats], rows] = await Promise.all([
    db.select({ n: count(), avg: avg(schema.reviews.rating) }).from(schema.reviews).innerJoin(schema.products, eq(schema.products.id, schema.reviews.productId)).where(where),
    db
      .select({
        id: schema.reviews.id,
        name: schema.reviews.name,
        rating: schema.reviews.rating,
        body: schema.reviews.body,
        orderId: schema.reviews.orderId,
        photoIds: schema.reviews.photoIds,
        productTitle: schema.products.title,
        productHandle: schema.products.handle,
      })
      .from(schema.reviews)
      .innerJoin(schema.products, eq(schema.products.id, schema.reviews.productId))
      .where(where)
      .orderBy(desc(schema.reviews.createdAt), desc(schema.reviews.id))
      .limit(limit),
  ]);
  const n = Number(stats?.n ?? 0);
  return {
    count: n,
    average: n ? Math.round(Number(stats?.avg) * 10) / 10 : null,
    latest: rows.map(({ orderId, photoIds, ...r }) => ({ ...r, verified: !!orderId, photoUrl: photoIds[0] ? reviewPhotoUrl(photoIds[0]) : null })),
  };
}
export type StoreReviews = Awaited<ReturnType<typeof storeReviews>>;

export async function countPendingReviews(db: Db, shopId: string) {
  const [row] = await db.select({ n: count() }).from(schema.reviews).where(and(eq(schema.reviews.shopId, shopId), eq(schema.reviews.status, "pending")));
  return Number(row?.n ?? 0);
}
