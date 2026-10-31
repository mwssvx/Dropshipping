import { and, avg, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import type { Mailer } from "./email";
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

/**
 * For a buyer's account page: the products on each of these orders still waiting for a review, the
 * same ones the order page asks about (shipped orders, not replacements, one per product), in two
 * queries for the whole list.
 */
export async function awaitingReview(db: Db, shopId: string, orderIds: string[]): Promise<Map<string, { productId: string; title: string }[]>> {
  const result = new Map<string, { productId: string; title: string }[]>();
  if (!orderIds.length) return result;
  const lines = await db
    .selectDistinct({ orderId: schema.orders.id, productId: schema.products.id, title: schema.products.title })
    .from(schema.orderLines)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
    .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
    .where(
      and(
        eq(schema.orders.shopId, shopId),
        inArray(schema.orders.id, orderIds),
        inArray(schema.orders.fulfillmentStatus, [...REVIEWABLE]),
        sql`${schema.orders.source} is distinct from 'replacement'`,
        sql`${schema.orders.paymentStatus} <> 'refunded'`,
      ),
    );
  if (!lines.length) return result;
  const done = await db
    .select({ orderId: schema.reviews.orderId, productId: schema.reviews.productId })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.shopId, shopId), inArray(schema.reviews.orderId, [...new Set(lines.map((l) => l.orderId))])));
  const reviewed = new Set(done.map((d) => `${d.orderId}:${d.productId}`));
  for (const l of lines) {
    if (reviewed.has(`${l.orderId}:${l.productId}`)) continue;
    result.set(l.orderId, [...(result.get(l.orderId) ?? []), { productId: l.productId, title: l.title }]);
  }
  for (const items of result.values()) items.sort((a, b) => a.title.localeCompare(b.title));
  return result;
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
  opts: { status?: ReviewStatus; rating?: number; query?: string; page?: number; size?: number; noReply?: boolean; photos?: boolean; reported?: boolean } = {},
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
    opts.noReply ? isNull(r.reply) : undefined,
    opts.photos ? sql`jsonb_array_length(${r.photoIds}) > 0` : undefined,
    opts.reported ? gt(r.reportCount, 0) : undefined,
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
  input: { status?: "published" | "hidden"; reply?: string | null; removePhotoId?: string; clearReports?: boolean },
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
    // Hiding a review, or keeping it ("Keep it"), deals with its reports.
    ...((input.clearReports || input.status === "hidden") && current.reportCount ? { reportCount: 0 } : {}),
  };
  if (!Object.keys(changes).length) return current;
  const [row] = await db.update(schema.reviews).set(changes).where(eq(schema.reviews.id, current.id)).returning();
  if (removed) await deleteMedia(db, [removed]);
  return row;
}

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "there";

/**
 * Emails the buyer who wrote a review the store's reply, the first time a published review has
 * one. Only reviews written for an order (so there's an address); imported ones never email, and
 * nor do buyers who unsubscribed from the store. Returns whether an email went out.
 */
export async function notifyReviewReply(db: Db, mailer: Mailer, shop: { id: string; name: string }, reviewId: string, storeAddress: string) {
  const r = schema.reviews;
  // Claim first, so two saves at once can't email twice.
  const [review] = await db
    .update(r)
    .set({ replyNotifiedAt: new Date() })
    .where(and(eq(r.id, reviewId), eq(r.shopId, shop.id), eq(r.status, "published"), sql`${r.reply} is not null`, sql`${r.orderId} is not null`, sql`${r.replyNotifiedAt} is null`))
    .returning();
  if (!review?.orderId || !review.reply) return false;
  const [row] = await db
    .select({ email: schema.orders.email, address: schema.orders.shippingAddress, title: schema.products.title, handle: schema.products.handle })
    .from(schema.orders)
    .innerJoin(schema.products, eq(schema.products.id, review.productId))
    .where(eq(schema.orders.id, review.orderId));
  if (!row?.email) return false;
  const customer = await db.query.customers.findFirst({ where: and(eq(schema.customers.shopId, shop.id), eq(schema.customers.email, row.email)) });
  if (customer?.unsubscribedAt) return false;
  const quote = review.body.length > 200 ? `${review.body.slice(0, 199).trimEnd()}…` : review.body;
  await mailer.send({
    to: row.email,
    subject: `${shop.name} replied to your review`,
    text: [
      `Hi ${firstName(row.address?.name ?? review.name)},`,
      ``,
      `Thanks for reviewing ${row.title}. You wrote:`,
      ``,
      ...quote.split("\n").map((l) => `> ${l}`),
      ``,
      `${shop.name} replied:`,
      ``,
      review.reply,
      ``,
      `See it on the product page: ${storeAddress}/products/${row.handle}#review-${review.id}`,
    ].join("\n"),
  });
  return true;
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

/** How a product page orders its reviews. */
export type ReviewSort = "newest" | "helpful";

/** The review order from a link: "helpful", or newest first for anything else. */
export const reviewSort = (value: string | undefined): ReviewSort => (value === "helpful" ? "helpful" : "newest");

/** The query string for a product page's review list: which stars, which order, and whether all are shown. */
export function reviewsQuery(view: { stars?: number | null; photos?: boolean; sort?: ReviewSort; all?: boolean }) {
  const q = new URLSearchParams();
  if (view.stars) q.set("stars", String(view.stars));
  if (view.photos) q.set("photos", "1");
  if (view.sort === "helpful") q.set("sort", "helpful");
  if (view.all) q.set("reviews", "all");
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Published reviews for a product page, with the average for the stars and search results and how
 * many there are of each star rating. `stars` lists only reviews with that rating; the count,
 * average and breakdown always cover them all. `photos` lists only reviews with buyer photos, and
 * `sort: "helpful"` puts the reviews most shoppers found helpful first, newest first among equals.
 */
export async function productReviews(db: Db, productId: string, limit = REVIEWS_SHOWN, opts: { stars?: number | null; photos?: boolean; sort?: ReviewSort } = {}) {
  const where = and(eq(schema.reviews.productId, productId), eq(schema.reviews.status, "published"));
  const hasPhotos = sql`jsonb_array_length(${schema.reviews.photoIds}) > 0`;
  const listed = and(where, opts.stars ? eq(schema.reviews.rating, opts.stars) : undefined, opts.photos ? hasPhotos : undefined);
  const order = opts.sort === "helpful"
    ? [desc(schema.reviews.helpfulCount), desc(schema.reviews.createdAt), desc(schema.reviews.id)]
    : [desc(schema.reviews.createdAt), desc(schema.reviews.id)];
  const [byRating, reviews, [listedRow], [photoRow]] = await Promise.all([
    db.select({ rating: schema.reviews.rating, n: count() }).from(schema.reviews).where(where).groupBy(schema.reviews.rating),
    db.query.reviews.findMany({ where: listed, orderBy: order, limit }),
    db.select({ n: count() }).from(schema.reviews).where(listed),
    db.select({ n: count() }).from(schema.reviews).where(and(where, hasPhotos)),
  ]);
  // breakdown[0] is one star, breakdown[4] five.
  const breakdown = [1, 2, 3, 4, 5].map((r) => Number(byRating.find((b) => b.rating === r)?.n ?? 0));
  const n = breakdown.reduce((a, b) => a + b, 0);
  const total = breakdown.reduce((a, b, i) => a + b * (i + 1), 0);
  // The newest buyer photos for the strip above the reviews, from any published review.
  const withPhotos = await db.query.reviews.findMany({
    where: and(where, hasPhotos),
    orderBy: desc(schema.reviews.createdAt),
    columns: { id: true, name: true, rating: true, photoIds: true },
    limit: 12,
  });
  const photos = withPhotos.flatMap((r) => r.photoIds.map((id) => ({ url: reviewPhotoUrl(id), reviewId: r.id, name: r.name, rating: r.rating }))).slice(0, 12);
  const listedCount = Number(listedRow?.n ?? 0);
  // How many reviews have photos, for the "With photos" filter.
  const withPhotosCount = Number(photoRow?.n ?? 0);
  return { count: n, average: n ? Math.round((total / n) * 10) / 10 : null, reviews, photos, breakdown, listedCount, withPhotosCount };
}

/** A device's "helpful" id: the random value the store keeps in a cookie. */
export const VOTER_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Marks a published review on this store helpful for this device, or takes the mark back when it
 * is already there. Returns whether it is marked now and the new count.
 */
export async function toggleHelpful(db: Db, shopId: string, reviewId: string, voter: string) {
  if (!VOTER_PATTERN.test(voter) || !z.string().uuid().safeParse(reviewId).success) throw new NotFoundError("Review");
  const review = await db.query.reviews.findFirst({
    where: and(eq(schema.reviews.id, reviewId), eq(schema.reviews.shopId, shopId), eq(schema.reviews.status, "published")),
    columns: { id: true },
  });
  if (!review) throw new NotFoundError("Review");
  return db.transaction(async (tx) => {
    const [added] = await tx.insert(schema.reviewVotes).values({ reviewId, voter }).onConflictDoNothing().returning();
    if (!added) await tx.delete(schema.reviewVotes).where(and(eq(schema.reviewVotes.reviewId, reviewId), eq(schema.reviewVotes.voter, voter)));
    const [row] = await tx
      .update(schema.reviews)
      .set({ helpfulCount: sql`greatest(0, ${schema.reviews.helpfulCount} + ${added ? 1 : -1})` })
      .where(eq(schema.reviews.id, reviewId))
      .returning({ helpfulCount: schema.reviews.helpfulCount });
    return { voted: !!added, count: row!.helpfulCount };
  });
}

/** Which of these reviews this device has marked helpful. */
export async function helpfulVotes(db: Db, voter: string | undefined, reviewIds: string[]): Promise<Set<string>> {
  if (!voter || !VOTER_PATTERN.test(voter) || !reviewIds.length) return new Set();
  const rows = await db
    .select({ reviewId: schema.reviewVotes.reviewId })
    .from(schema.reviewVotes)
    .where(and(eq(schema.reviewVotes.voter, voter), inArray(schema.reviewVotes.reviewId, reviewIds)));
  return new Set(rows.map((r) => r.reviewId));
}

/**
 * A shopper reports a published review to the merchant (fake, rude, not about the product). Once
 * per review and device; the review stays up until the merchant hides it. Returns whether this
 * report was new.
 */
export async function reportReview(db: Db, shopId: string, reviewId: string, voter: string) {
  if (!VOTER_PATTERN.test(voter) || !z.string().uuid().safeParse(reviewId).success) throw new NotFoundError("Review");
  const review = await db.query.reviews.findFirst({
    where: and(eq(schema.reviews.id, reviewId), eq(schema.reviews.shopId, shopId), eq(schema.reviews.status, "published")),
    columns: { id: true },
  });
  if (!review) throw new NotFoundError("Review");
  return db.transaction(async (tx) => {
    const [added] = await tx.insert(schema.reviewReports).values({ reviewId, voter }).onConflictDoNothing().returning();
    if (added) await tx.update(schema.reviews).set({ reportCount: sql`${schema.reviews.reportCount} + 1` }).where(eq(schema.reviews.id, reviewId));
    return !!added;
  });
}

/** Which of these reviews this device has reported. */
export async function reportedReviews(db: Db, voter: string | undefined, reviewIds: string[]): Promise<Set<string>> {
  if (!voter || !VOTER_PATTERN.test(voter) || !reviewIds.length) return new Set();
  const rows = await db
    .select({ reviewId: schema.reviewReports.reviewId })
    .from(schema.reviewReports)
    .where(and(eq(schema.reviewReports.voter, voter), inArray(schema.reviewReports.reviewId, reviewIds)));
  return new Set(rows.map((r) => r.reviewId));
}

/** How many reviews shoppers have reported that the merchant hasn't dealt with yet. */
export async function reportedReviewCount(db: Db, shopId: string) {
  const [row] = await db.select({ n: count() }).from(schema.reviews).where(and(eq(schema.reviews.shopId, shopId), gt(schema.reviews.reportCount, 0)));
  return Number(row?.n ?? 0);
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
